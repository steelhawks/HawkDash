import { el, fmt, fmtInt, statCard, panel, viewHeader, chartBox, bar } from "../ui.js?v=7";
import { timeChart, alignSeries, chartPalette } from "../charts.js?v=7";

// The Rebuilt2026 robot uses BatteryUtil (org.steelhawks.util.BatteryUtil) to
// sum every motor's supply current at runtime and integrate amp-hours / watt-hours.
// Its outputs land at /RealOutputs/BatteryUtil/... and they're the source of truth
// for whole-robot power because the PDH is *not* connected to CAN on this robot —
// /PowerDistribution/ChannelCurrent is therefore all zeros and we hide it.
//
// Fallback chain when BatteryUtil isn't present (older logs):
//   current  -> /RealOutputs/BatteryUtil/CurrentAmps  ||  /RealOutputs/BatteryUtil/TotalCurrentDraw
//             -> /SystemStats/BatteryCurrent  (RIO input only — undercounts)
//   power    -> /RealOutputs/BatteryUtil/Power  ||  V * I derived
//   energy   -> /RealOutputs/BatteryUtil/WattHours
//   amp-hr   -> /RealOutputs/BatteryUtil/AmpHoursUsed

function batteryUtil(store) {
    return {
        current:   store.get("/RealOutputs/BatteryUtil/CurrentAmps")
                || store.get("/RealOutputs/BatteryUtil/TotalCurrentDraw"),
        power:     store.get("/RealOutputs/BatteryUtil/Power"),
        wattHours: store.get("/RealOutputs/BatteryUtil/WattHours"),
        ampHours:  store.get("/RealOutputs/BatteryUtil/AmpHoursUsed"),
    };
}

function liveBatteryV(store) {
    return store.get("/SystemStats/BatteryVoltage")
        || store.get("RobotController/BatteryVoltage")
        || store.get("/PowerDistribution/Voltage");
}

// True if a PDH ChannelCurrent[] entry is present but contains no real readings —
// either it never logged anything non-zero (PDH not on the CAN bus) or every
// channel sample is the zero array.
function pdhAllZero(channels) {
    if (!channels || !channels.length) return true;
    const eps = 1e-3;
    for (const c of channels) {
        for (let i = 0; i < c.values.length; i++) {
            if (Math.abs(c.values[i]) > eps) return false;
        }
    }
    return true;
}

function pdhChannelSeries(store) {
    const arr = store.get("/PowerDistribution/ChannelCurrent");
    if (!arr || arr.kind !== "object") return null;
    let nChan = 0;
    for (let i = 0; i < arr.count; i++) {
        const v = arr.values[i];
        if (v && v.length > nChan) nChan = v.length;
    }
    if (!nChan) return null;
    const series = [];
    for (let c = 0; c < nChan; c++) {
        const ts = new Float64Array(arr.count);
        const vs = new Float64Array(arr.count);
        for (let i = 0; i < arr.count; i++) {
            ts[i] = arr.timestamps[i];
            const v = arr.values[i];
            vs[i] = v && c < v.length ? v[c] : 0;
        }
        series.push({ idx: c, timestamps: ts, values: vs });
    }
    return series;
}

function batteryUtilDevices(store) {
    const re = /^\/?RealOutputs\/BatteryUtil\/Devices\/(.+)$/;
    const out = [];
    for (const e of store.entries.values()) {
        const m = re.exec(e.name);
        if (m && e.kind === "numeric") out.push({ name: m[1], entry: e });
    }
    return out;
}

// Auto-discover per-motor supply current entries: any numeric entry under a
// known subsystem prefix whose name ends with SupplyCurrentAmps or CurrentAmps,
// excluding torque-current channels.
function motorCurrents(store) {
    const re = /^\/?(Flywheel|Hood|Turret|Intake|Indexer|Swerve)\/.*?(SupplyCurrentAmps|CurrentAmps)$/i;
    const out = [];
    for (const e of store.entries.values()) {
        if (e.kind !== "numeric") continue;
        if (!re.test(e.name)) continue;
        if (/torquecurrent/i.test(e.name)) continue;
        const label = e.name
            .replace(/^\/?/, "")
            .replace(/\/Inputs\//i, "/")
            .replace(/SupplyCurrentAmps$/i, "")
            .replace(/CurrentAmps$/i, "");
        out.push({ label, entry: e });
    }
    return out;
}

// Forward-fill voltage at each current sample to derive instantaneous power.
function derivePower(voltage, current) {
    if (!voltage || !current || voltage.kind !== "numeric" || current.kind !== "numeric"
        || voltage.count === 0 || current.count === 0) return null;
    const ts = new Float64Array(current.count);
    const vs = new Float64Array(current.count);
    let vi = 0, vlast = voltage.values[0];
    for (let i = 0; i < current.count; i++) {
        const t = current.timestamps[i];
        while (vi < voltage.count && voltage.timestamps[vi] <= t) { vlast = voltage.values[vi]; vi++; }
        ts[i] = t;
        vs[i] = current.values[i] * vlast;
    }
    return { timestamps: ts, values: vs, name: "(derived)", count: current.count };
}

export function render(container, store) {
    const root = el("div");
    root.appendChild(viewHeader("Power", "Battery & per-device current draw (BatteryUtil)"));

    const voltage = liveBatteryV(store);
    const bu = batteryUtil(store);
    const sysCurrent = store.get("/SystemStats/BatteryCurrent");

    // Total current: BatteryUtil first; SystemStats is RIO input only.
    const current = bu.current || sysCurrent;
    const currentSource = bu.current
        ? `BatteryUtil/${bu.current.name.split("/").pop()}`
        : sysCurrent ? "/SystemStats/BatteryCurrent (RIO input only — undercounts)" : null;

    // Power: BatteryUtil/Power preferred; otherwise V*I derived.
    const derived = !bu.power && voltage && current ? derivePower(voltage, current) : null;
    const power = bu.power || derived;
    const powerSource = bu.power
        ? "/RealOutputs/BatteryUtil/Power"
        : derived ? "derived V × I" : null;

    // Energy.
    const energy = bu.wattHours;
    const ampHours = bu.ampHours;

    // Top stat cards.
    const stats = el("div", { class: "stat-grid" });
    stats.appendChild(statCard("Min battery voltage",
        fmt(voltage ? store.minOf(voltage.name) : null, 2, " V"),
        { cls: "warn", sub: voltage ? `mean ${fmt(store.meanOf(voltage.name), 2, " V")}` : null }));
    stats.appendChild(statCard("Max draw",
        fmt(current ? store.maxOf(current.name) : null, 1, " A"),
        { cls: "bad", sub: current ? `mean ${fmt(store.meanOf(current.name), 1, " A")}` : null }));
    stats.appendChild(statCard("Peak power",
        fmt(power ? Math.max(...power.values) : null, 0, " W"),
        { cls: "accent", sub: powerSource }));
    stats.appendChild(statCard("Energy used",
        energy ? fmt(store.lastOf(energy.name), 2, " Wh") : "—",
        { sub: ampHours ? `${fmt(store.lastOf(ampHours.name), 3, " Ah")}` : null }));
    root.appendChild(stats);

    // Tell the user which source is being used (BatteryUtil vs SystemStats).
    if (currentSource || powerSource) {
        const note = el("div", { class: "panel-sub", style: "margin-bottom: 12px;" },
            currentSource ? `Current source: ${currentSource}` : "",
            currentSource && powerSource ? "  ·  " : "",
            powerSource ? `Power source: ${powerSource}` : "");
        root.appendChild(note);
    }

    // Battery V / I / P chart panel.
    if (voltage || current || power) {
        const p = panel("Battery & total draw", "Live voltage, current, and power");
        const grid = el("div", { class: "panel-grid cols-2" });
        if (voltage) {
            const box = chartBox();
            grid.appendChild(el("div", {},
                el("div", { class: "panel-sub" }, `Voltage (V) — ${voltage.name}`),
                box));
            timeChart(box, [{ timestamps: voltage.timestamps, values: voltage.values, label: "Voltage", color: "#fcd34d" }], { yLabel: "V" });
        }
        if (current) {
            const box = chartBox();
            grid.appendChild(el("div", {},
                el("div", { class: "panel-sub" }, `Total current (A) — ${current.name}`),
                box));
            timeChart(box, [{ timestamps: current.timestamps, values: current.values, label: "Current", color: "#ef4444" }], { yLabel: "A" });
        }
        if (power) {
            const box = chartBox();
            grid.appendChild(el("div", {},
                el("div", { class: "panel-sub" }, `Power (W) — ${powerSource}`),
                box));
            timeChart(box, [{ timestamps: power.timestamps, values: power.values, label: "Power", color: "#ff7a00" }], { yLabel: "W" });
        }
        if (energy) {
            const box = chartBox();
            grid.appendChild(el("div", {},
                el("div", { class: "panel-sub" }, `Cumulative energy (Wh) — ${energy.name}`),
                box));
            timeChart(box, [{ timestamps: energy.timestamps, values: energy.values, label: "Energy", color: "#60a5fa" }], { yLabel: "Wh" });
        }
        p.appendChild(grid);
        root.appendChild(p);
    }

    // BatteryUtil per-device current (primary breakdown for this robot).
    const devices = batteryUtilDevices(store);
    if (devices.length) {
        const p = panel("Per-device current (BatteryUtil)",
            `${devices.length} devices · /RealOutputs/BatteryUtil/Devices/*`);
        const box = chartBox({ tall: true });
        p.appendChild(box);
        const seriesList = devices.map(({ name, entry }, i) => ({
            timestamps: entry.timestamps, values: entry.values, label: name,
            color: chartPalette[i % chartPalette.length],
        }));
        timeChart(box, seriesList, { yLabel: "A" });

        const peaks = devices.map(({ name, entry }) => ({
            label: name,
            peak: store.maxOf(entry.name) ?? 0,
            mean: store.meanOf(entry.name) ?? 0,
        })).sort((a, b) => b.peak - a.peak);
        const max = peaks[0]?.peak || 1;
        const bars = el("div", {}, el("div", { class: "panel-sub" }, "Peak current per device"));
        for (const c of peaks) {
            bars.appendChild(bar(c.label, c.peak, max,
                v => `${v.toFixed(1)} A peak · ${c.mean.toFixed(2)} A avg`));
        }
        p.appendChild(bars);
        root.appendChild(p);
    } else {
        // BatteryUtil missing -> remind user.
        root.appendChild(panel("BatteryUtil per-device draw",
            "Not present in this log",
            el("div", { class: "empty-note" },
                "No /RealOutputs/BatteryUtil/Devices/* entries found. " +
                "If you expect them, make sure BatteryUtil.recordCurrentUsage(...) and " +
                "BatteryUtil.integrateAndLogTotal() are being called every loop.")));
    }

    // PDH per-channel — only show if real data is present (PDH on CAN).
    const channels = pdhChannelSeries(store);
    if (channels && !pdhAllZero(channels)) {
        const p = panel("PDH per-channel current",
            `${channels.length} channels · /PowerDistribution/ChannelCurrent`);
        const box = chartBox({ tall: true });
        p.appendChild(box);
        const seriesList = channels.map(c => ({
            timestamps: c.timestamps, values: c.values, label: `Ch ${c.idx}`,
            color: chartPalette[c.idx % chartPalette.length],
        }));
        timeChart(box, seriesList, { yLabel: "A" });

        const peaks = channels.map(c => {
            let peak = 0, sum = 0, n = 0;
            for (let i = 0; i < c.values.length; i++) {
                const v = Math.abs(c.values[i]);
                if (Number.isFinite(v)) { sum += v; n++; if (v > peak) peak = v; }
            }
            return { idx: c.idx, peak, mean: n ? sum / n : 0 };
        }).sort((a, b) => b.peak - a.peak);
        const max = peaks[0]?.peak || 1;
        const bars = el("div", {}, el("div", { class: "panel-sub" }, "Peak current per channel"));
        for (const c of peaks.slice(0, 24)) {
            bars.appendChild(bar(`Channel ${c.idx}`, c.peak, max,
                v => `${v.toFixed(1)} A peak · ${c.mean.toFixed(1)} A avg`));
        }
        p.appendChild(bars);
        root.appendChild(p);
    } else if (channels) {
        // PDH channels exist but are all zero — PDH isn't on the CAN bus.
        root.appendChild(panel("PDH per-channel current",
            "PDH not on CAN bus",
            el("div", { class: "empty-note" },
                "/PowerDistribution/ChannelCurrent is present but every sample is zero — " +
                "the PDH on this robot isn't connected to the CAN bus, so per-channel " +
                "currents aren't reported. Use the BatteryUtil per-device breakdown above instead.")));
    }

    // Subsystem motor supply currents (auto-discovered) — useful as a sanity-check.
    const motors = motorCurrents(store);
    if (motors.length) {
        const p = panel("Motor supply currents",
            `${motors.length} motors with logged supply current (raw subsystem inputs)`);
        const box = chartBox({ tall: true });
        p.appendChild(box);
        const seriesList = motors.map(({ label, entry }, i) => ({
            timestamps: entry.timestamps, values: entry.values, label,
            color: chartPalette[i % chartPalette.length],
        }));
        timeChart(box, seriesList, { yLabel: "A" });

        const peaks = motors.map(({ label, entry }) => ({
            label,
            peak: store.maxOf(entry.name) ?? 0,
            mean: store.meanOf(entry.name) ?? 0,
        })).sort((a, b) => b.peak - a.peak);
        const max = peaks[0]?.peak || 1;
        const bars = el("div", {}, el("div", { class: "panel-sub" }, "Peak current per motor"));
        for (const c of peaks) {
            bars.appendChild(bar(c.label, c.peak, max,
                v => `${v.toFixed(1)} A peak · ${c.mean.toFixed(2)} A avg`));
        }
        p.appendChild(bars);
        root.appendChild(p);
    }

    if (!root.querySelector(".panel")) {
        root.appendChild(el("div", { class: "empty-note" }, "No power-related entries were found in this log."));
    }
    container.appendChild(root);
}

export const meta = { id: "power", label: "Power", icon: "⚡" };
