import { el, fmt, fmtInt, statCard, panel, viewHeader, chartBox, bar } from "../ui.js";
import { timeChart, alignSeries, chartPalette } from "../charts.js";

// On a real log the live battery time-series lives at /SystemStats/BatteryVoltage and
// /SystemStats/BatteryCurrent (auto-logged by AdvantageKit). The /PowerDistribution/*
// keys exist but most are logged once at startup and aren't useful for charts —
// except /PowerDistribution/ChannelCurrent which is a `double[]` time-series where
// each sample is the array of all channel currents.

function liveBatteryV(store) {
    return store.get("/SystemStats/BatteryVoltage")
        || store.get("/PowerDistribution/Voltage")
        || store.get("RobotController/BatteryVoltage");
}

function liveBatteryI(store) {
    return store.get("/SystemStats/BatteryCurrent")
        || store.get("/PowerDistribution/TotalCurrent")
        || store.get("/PowerDistribution/Current")
        || store.get("RealOutputs/BatteryUtil/CurrentAmps");
}

// Per-channel currents from the /PowerDistribution/ChannelCurrent double[] entry.
// Returns: [{ idx, timestamps, values }] suitable for charting.
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

// BatteryUtil per-device current entries (custom from the robot code).
function batteryUtilDevices(store) {
    const re = /^\/?RealOutputs\/BatteryUtil\/Devices\/(.+)$/;
    const out = [];
    for (const e of store.entries.values()) {
        const m = re.exec(e.name);
        if (m && e.kind === "numeric") out.push({ name: m[1], entry: e });
    }
    return out;
}

// Auto-discover per-motor supply current entries: any numeric entry whose name
// ends with "SupplyCurrentAmps" or "CurrentAmps" under a known subsystem prefix.
function motorCurrents(store) {
    const re = /^\/?(Flywheel|Hood|Turret|Intake|Indexer|Swerve)\/.*?(SupplyCurrentAmps|CurrentAmps)$/i;
    const out = [];
    for (const e of store.entries.values()) {
        if (e.kind !== "numeric") continue;
        if (!re.test(e.name)) continue;
        // Skip torque current (already covered by supply for total power).
        if (/torquecurrent/i.test(e.name)) continue;
        // Build a friendly label.
        const label = e.name
            .replace(/^\/?/, "")
            .replace(/\/Inputs\//i, "/")
            .replace(/SupplyCurrentAmps$/i, "")
            .replace(/CurrentAmps$/i, "");
        out.push({ label, entry: e });
    }
    return out;
}

export function render(container, store) {
    const root = el("div");
    root.appendChild(viewHeader("Power", "Battery, PDH per-channel currents, and per-device draw"));

    const voltage = liveBatteryV(store);
    const current = liveBatteryI(store);
    const power = store.get("/PowerDistribution/TotalPower") || store.get("RealOutputs/BatteryUtil/Power");
    const energy = store.get("/PowerDistribution/TotalEnergy") || store.get("RealOutputs/BatteryUtil/WattHours");
    const ampHours = store.get("RealOutputs/BatteryUtil/AmpHoursUsed");

    const stats = el("div", { class: "stat-grid" });
    stats.appendChild(statCard("Min battery voltage",
        fmt(voltage ? store.minOf(voltage.name) : null, 2, " V"),
        { cls: "warn", sub: voltage ? `mean ${fmt(store.meanOf(voltage.name), 2, " V")}` : null }));
    stats.appendChild(statCard("Max draw",
        fmt(current ? store.maxOf(current.name) : null, 1, " A"),
        { cls: "bad", sub: current ? `mean ${fmt(store.meanOf(current.name), 1, " A")}` : null }));

    // Derive instantaneous power if both V and I exist.
    let derivedPeakPower = null, derivedAvgPower = null;
    if (voltage && current && voltage.kind === "numeric" && current.kind === "numeric" && voltage.count && current.count) {
        // Sample power at each current sample, using forward-filled voltage.
        let peak = 0, sum = 0, n = 0, vi = 0, vlast = voltage.values[0];
        for (let i = 0; i < current.count; i++) {
            const t = current.timestamps[i];
            while (vi < voltage.count && voltage.timestamps[vi] <= t) { vlast = voltage.values[vi]; vi++; }
            const p = current.values[i] * vlast;
            if (Number.isFinite(p)) { sum += p; n++; if (p > peak) peak = p; }
        }
        derivedPeakPower = peak; derivedAvgPower = n ? sum / n : null;
    }
    stats.appendChild(statCard("Peak power",
        fmt(power ? store.maxOf(power.name) : derivedPeakPower, 0, " W"),
        { cls: "accent", sub: derivedAvgPower != null ? `mean ${fmt(derivedAvgPower, 0, " W")}` : null }));
    stats.appendChild(statCard("Energy used",
        fmt(energy ? store.lastOf(energy.name) : null, 1, energy ? " J" : ""),
        { sub: ampHours ? `${fmt(store.lastOf(ampHours.name), 3, " Ah")}` : null }));
    root.appendChild(stats);

    // Battery V / I / P chart panel.
    if (voltage || current) {
        const p = panel("Battery & total draw", "Live voltage and current");
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
        p.appendChild(grid);
        root.appendChild(p);
    }

    // PDH per-channel currents (from /PowerDistribution/ChannelCurrent double[]).
    const channels = pdhChannelSeries(store);
    if (channels && channels.length) {
        // Chart all channels.
        const p = panel("PDH per-channel current", `${channels.length} channels · /PowerDistribution/ChannelCurrent`);
        const box = chartBox({ tall: true });
        p.appendChild(box);
        const seriesList = channels.map(c => ({
            timestamps: c.timestamps,
            values: c.values,
            label: `Ch ${c.idx}`,
            color: chartPalette[c.idx % chartPalette.length],
        }));
        timeChart(box, seriesList, { yLabel: "A" });

        // Peak current bar list.
        const peaks = channels.map(c => {
            let peak = 0, sum = 0, n = 0;
            for (let i = 0; i < c.values.length; i++) {
                const v = c.values[i];
                if (Number.isFinite(v)) { sum += Math.abs(v); n++; if (Math.abs(v) > peak) peak = Math.abs(v); }
            }
            return { idx: c.idx, peak, mean: n ? sum / n : 0 };
        }).sort((a, b) => b.peak - a.peak);
        const max = peaks[0]?.peak || 1;
        const bars = el("div", {}, el("div", { class: "panel-sub" }, "Peak current per channel"));
        for (const c of peaks.slice(0, 24)) {
            bars.appendChild(bar(`Channel ${c.idx}`, c.peak, max, v => `${v.toFixed(1)} A peak · ${c.mean.toFixed(1)} A avg`));
        }
        p.appendChild(bars);
        root.appendChild(p);
    }

    // BatteryUtil per-device.
    const devices = batteryUtilDevices(store);
    if (devices.length) {
        const p = panel("Per-device current draw", `${devices.length} devices · BatteryUtil`);
        const box = chartBox({ tall: true });
        p.appendChild(box);
        const seriesList = devices.map(({ name, entry }, i) => ({
            timestamps: entry.timestamps, values: entry.values, label: name, color: chartPalette[i % chartPalette.length],
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
            bars.appendChild(bar(c.label, c.peak, max, v => `${v.toFixed(1)} A peak · ${c.mean.toFixed(2)} A avg`));
        }
        p.appendChild(bars);
        root.appendChild(p);
    }

    // Subsystem motor supply currents (auto-discovered).
    const motors = motorCurrents(store);
    if (motors.length) {
        const p = panel("Motor supply currents", `${motors.length} motors with logged supply current`);
        const box = chartBox({ tall: true });
        p.appendChild(box);
        const seriesList = motors.map(({ label, entry }, i) => ({
            timestamps: entry.timestamps, values: entry.values, label, color: chartPalette[i % chartPalette.length],
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
            bars.appendChild(bar(c.label, c.peak, max, v => `${v.toFixed(1)} A peak · ${c.mean.toFixed(2)} A avg`));
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
