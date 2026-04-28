import { el, fmt, panel, viewHeader, chartBox, bar } from "../ui.js";
import { timeChart, chartPalette } from "../charts.js";

function loopTimeEntries(store) {
    // Custom: /RealOutputs/LoopTimes/{subsystem}ms
    const re = /^\/?RealOutputs\/LoopTimes\/(.+)ms$/;
    const out = [];
    for (const e of store.entries.values()) {
        const m = re.exec(e.name);
        if (m) out.push({ name: m[1], entry: e });
    }
    return out;
}

function akSubsystemPeriodics(store) {
    // AdvantageKit auto-logs `/LoggedRobot/FullCycleMS`, `/Timing/...`,
    // and per-`processInputs` timing under `/<Subsystem>/<Inputs>/...`. The
    // standard LoggedRobot keys we care about here.
    const candidates = [
        "/LoggedRobot/FullCycleMS",
        "/Timing/RobotPeriodicMS",
        "/Timing/LoggedRobotMS",
    ];
    const seen = new Set();
    const out = [];
    for (const c of candidates) {
        const e = store.get(c);
        if (e && !seen.has(e.name)) { out.push(e); seen.add(e.name); }
    }
    return out;
}

export function render(container, store) {
    const root = el("div");
    root.appendChild(viewHeader("Timing", "Per-subsystem loop times and scheduler stats"));

    const ltes = loopTimeEntries(store);
    if (ltes.length) {
        const p = panel("LoopTimeUtil per-subsystem", `${ltes.length} subsystems · time spent in periodic() (ms)`);
        const box = chartBox({ tall: true });
        p.appendChild(box);
        const seriesList = ltes.map(({ name, entry }, i) => ({
            timestamps: entry.timestamps, values: entry.values, label: name, color: chartPalette[i % chartPalette.length],
        }));
        timeChart(box, seriesList, { yLabel: "ms" });

        // Top peaks ranking.
        const ranked = ltes.map(({ name, entry }) => ({
            name,
            peak: store.maxOf(entry.name) ?? 0,
            mean: store.meanOf(entry.name) ?? 0,
        })).sort((a, b) => b.peak - a.peak);
        const max = ranked[0]?.peak || 1;
        const bars = el("div", {}, el("div", { class: "panel-sub" }, "Peak periodic time per subsystem"));
        for (const r of ranked) {
            bars.appendChild(bar(r.name, r.peak, max, v => `${v.toFixed(2)} ms peak · ${r.mean.toFixed(3)} ms avg`));
        }
        p.appendChild(bars);
        root.appendChild(p);
    }

    // AdvantageKit cycle time.
    const cycles = akSubsystemPeriodics(store);
    for (const c of cycles) {
        const p = panel(c.name, "AdvantageKit cycle timing");
        const box = chartBox();
        p.appendChild(box);
        timeChart(box, [{ timestamps: c.timestamps, values: c.values, label: c.name, color: "#ff7a00" }], { yLabel: "ms" });
        root.appendChild(p);
    }

    // Loop overrun count delta over time (already shown on System but useful here too).
    const ov = store.get("/Timing/LoopOverrunCount") || store.get("Timing/LoopOverrunCount");
    if (ov) {
        const p = panel("Loop overrun count", "From AdvantageKit /Timing");
        const box = chartBox();
        p.appendChild(box);
        timeChart(box, [{ timestamps: ov.timestamps, values: ov.values, label: "Overruns", color: "#ef4444" }], {});
        root.appendChild(p);
    }

    if (!root.querySelector(".panel")) {
        root.appendChild(el("div", { class: "empty-note" }, "No timing entries found in this log."));
    }
    container.appendChild(root);
}

export const meta = { id: "timing", label: "Timing", icon: "⏱" };
