import { el, fmt, fmtInt, fmtPct, statCard, panel, viewHeader, chartBox } from "../ui.js?v=7";
import { timeChart, boolStrip } from "../charts.js?v=7";

// Note: Real Rebuilt2026 logs use /SystemStats/CPUTempCelsius (not CpuTemp),
// /SystemStats/CANBus/Utilization (not CanBusUtilization), /SystemStats/BatteryVoltage,
// /SystemStats/3v3Rail/* etc. Earlier AdvantageKit versions may use the older
// names — the store does case-insensitive fallback so both work.

function getRail(store, name) {
    return {
        v: store.get(`/SystemStats/${name}Rail/Voltage`),
        a: store.get(`/SystemStats/${name}Rail/Current`),
        active: store.get(`/SystemStats/${name}Rail/Active`),
    };
}

export function render(container, store) {
    const root = el("div");
    root.appendChild(viewHeader("System", "RoboRIO health: CPU, RAM, CAN, rails, brownouts"));

    const cpu = store.get("/SystemStats/CPUTempCelsius") || store.get("/SystemStats/CpuTemp");
    const canUtil = store.get("/SystemStats/CANBus/Utilization") || store.get("/SystemStats/CanBusUtilization");
    const ramFree = store.get("/SystemStats/RamFreeMB") || store.get("/SystemStats/RamUsageBytes");
    const brownedOut = store.get("/SystemStats/BrownedOut");
    const sysActive = store.get("/SystemStats/SystemActive");
    const rsl = store.get("/SystemStats/RSLState");
    const comms = store.get("/SystemStats/CommsDisableCount");
    const cycle = store.get("/RealOutputs/LoggedRobot/FullCycleMS");

    const stats = el("div", { class: "stat-grid" });
    if (cpu) stats.appendChild(statCard("CPU temp peak", fmt(store.maxOf(cpu.name), 1, " °C"), {
        cls: store.maxOf(cpu.name) > 70 ? "bad" : "warn",
        sub: `mean ${fmt(store.meanOf(cpu.name), 1, " °C")}`,
    }));
    if (canUtil) stats.appendChild(statCard("CAN util peak", fmt(store.maxOf(canUtil.name) * 100, 1, "%"), {
        sub: `mean ${fmt(store.meanOf(canUtil.name) * 100, 1, "%")}`,
    }));
    if (ramFree) stats.appendChild(statCard("RAM free min", fmt(store.minOf(ramFree.name), 0, " MB"), {
        cls: "warn",
        sub: `mean ${fmt(store.meanOf(ramFree.name), 0, " MB")}`,
    }));
    if (brownedOut) stats.appendChild(statCard("Brownouts", String(store.risingEdgesOf(brownedOut.name)), {
        cls: store.risingEdgesOf(brownedOut.name) > 0 ? "bad" : "good",
        sub: `${fmtPct(store.trueFractionOf(brownedOut.name))} of time`,
    }));
    if (comms) stats.appendChild(statCard("Comms drops", fmtInt(store.lastOf(comms.name)), { cls: store.lastOf(comms.name) ? "bad" : "good" }));
    if (cycle) stats.appendChild(statCard("Loop cycle peak", fmt(store.maxOf(cycle.name), 2, " ms"), {
        sub: `mean ${fmt(store.meanOf(cycle.name), 2, " ms")}`,
    }));
    root.appendChild(stats);

    if (cpu) {
        const p = panel("CPU temperature", "Celsius · drag to zoom · click ‘full range’ to disable outlier clip");
        const box = chartBox();
        p.appendChild(box);
        timeChart(box, [{ timestamps: cpu.timestamps, values: cpu.values, label: "CPU", color: "#ef4444" }], { yLabel: "°C", robust: true });
        root.appendChild(p);
    }

    if (canUtil) {
        const p = panel("CAN bus utilization", "Fraction (0-1) · clipped to p1..p99 so the startup spike doesn’t flatten the rest");
        const box = chartBox();
        p.appendChild(box);
        timeChart(box, [{ timestamps: canUtil.timestamps, values: canUtil.values, label: "Utilization", color: "#60a5fa" }], { robust: true });
        root.appendChild(p);
    }

    if (ramFree) {
        const p = panel(ramFree.name.includes("FreeMB") ? "RAM free (MB)" : "RAM usage", "");
        const box = chartBox();
        p.appendChild(box);
        timeChart(box, [{ timestamps: ramFree.timestamps, values: ramFree.values, label: "RAM", color: "#3ecf8e" }], { yLabel: "MB", robust: true });
        root.appendChild(p);
    }

    // Rails.
    const rails = ["3v3", "5v", "6v"].map(n => ({ name: n, ...getRail(store, n) })).filter(r => r.v || r.a);
    if (rails.length) {
        const p = panel("Power rails", "Voltage and current per rail");
        const grid = el("div", { class: "panel-grid cols-2" });
        for (const r of rails) {
            if (r.v) {
                const box = chartBox({ short: true });
                grid.appendChild(el("div", {},
                    el("div", { class: "panel-sub" }, `${r.name} rail voltage`),
                    box));
                timeChart(box, [{ timestamps: r.v.timestamps, values: r.v.values, label: r.name, color: "#fcd34d" }], { yLabel: "V" });
            }
            if (r.a) {
                const box = chartBox({ short: true });
                grid.appendChild(el("div", {},
                    el("div", { class: "panel-sub" }, `${r.name} rail current`),
                    box));
                timeChart(box, [{ timestamps: r.a.timestamps, values: r.a.values, label: r.name, color: "#60a5fa" }], { yLabel: "A" });
            }
        }
        p.appendChild(grid);
        root.appendChild(p);
    }

    // Loop cycle time.
    if (cycle) {
        const p = panel("Logger cycle time", "/RealOutputs/LoggedRobot/FullCycleMS · the first cycle is huge during init; clipped by default");
        const box = chartBox();
        p.appendChild(box);
        timeChart(box, [{ timestamps: cycle.timestamps, values: cycle.values, label: "Cycle", color: "#ff7a00" }], { yLabel: "ms", robust: true });
        root.appendChild(p);
    }

    // Brownout / SystemActive / RSL strips.
    const stripPanel = panel("State flags", "");
    let any = false;
    const flags = [
        [brownedOut, "BrownedOut", "#ef4444"],
        [sysActive, "SystemActive", "#3ecf8e"],
        [rsl, "RSL state", "#fcd34d"],
    ];
    for (const [e, label, color] of flags) {
        if (!e) continue;
        any = true;
        const row = el("div", { class: "bool-strip-row" },
            el("div", { class: "name" }, label),
            el("div", {}),
            el("div", { class: "pct" }, fmtPct(store.trueFractionOf(e.name))),
        );
        stripPanel.appendChild(row);
        const inner = el("div");
        row.children[1].appendChild(inner);
        boolStrip(inner, e, { totalSec: store.durationSec, color });
    }
    if (any) root.appendChild(stripPanel);

    if (!root.querySelector(".panel")) {
        root.appendChild(el("div", { class: "empty-note" }, "No SystemStats entries found in this log."));
    }
    container.appendChild(root);
}

export const meta = { id: "system", label: "System", icon: "🧠" };
