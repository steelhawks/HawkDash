import { el, fmtPct, statCard, panel, viewHeader, chartBox } from "../ui.js?v=7";
import { timeChart, boolStrip } from "../charts.js?v=7";

export function render(container, store) {
    const root = el("div");
    root.appendChild(viewHeader("Indexer", "Spindexer · Feeder · Beam break"));

    const stats = el("div", { class: "stat-grid" });
    stats.appendChild(statCard("Jammed events", String(store.risingEdgesOf("/RealOutputs/Indexer/Jammed")), { cls: "bad" }));
    const hasBalls = store.get("/RealOutputs/Indexer/HasBalls");
    if (hasBalls) stats.appendChild(statCard("Balls present %", fmtPct(store.trueFractionOf(hasBalls.name)), { cls: "good" }));
    stats.appendChild(statCard("Spindexer stall %", fmtPct(store.trueFractionOf("/RealOutputs/Indexer/SpindexerStalled")), { cls: "warn" }));
    stats.appendChild(statCard("Feeder stall %", fmtPct(store.trueFractionOf("/RealOutputs/Indexer/FeederStalled")), { cls: "warn" }));
    const beam = store.get("/Indexer/Beam/Inputs/Detected") || store.get("/Indexer/Beam/Inputs/detected");
    stats.appendChild(statCard("Beam trips", beam ? String(store.risingEdgesOf(beam.name)) : "—", {
        sub: beam ? `detected ${fmtPct(store.trueFractionOf(beam.name))}` : null,
    }));
    root.appendChild(stats);

    // Spindexer.
    const sp = panel("Spindexer", "Both motors");
    const grid = el("div", { class: "panel-grid cols-2" });
    const sv = [
        ["Indexer/Spindexer/Inputs/motor1VelocityRadPerSec", "Motor 1", "#60a5fa"],
        ["Indexer/Spindexer/Inputs/motor2VelocityRadPerSec", "Motor 2", "#3ecf8e"],
    ].map(([k, l, c]) => ({ e: store.get(k), label: l, color: c })).filter(x => x.e);
    if (sv.length) {
        const b = chartBox();
        grid.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Velocity"), b));
        timeChart(b, sv.map(s => ({ timestamps: s.e.timestamps, values: s.e.values, label: s.label, color: s.color })), { yLabel: "rad/s" });
    }
    const sc = [
        ["Indexer/Spindexer/Inputs/motor1CurrentAmps", "Motor 1", "#60a5fa"],
        ["Indexer/Spindexer/Inputs/motor2CurrentAmps", "Motor 2", "#3ecf8e"],
    ].map(([k, l, c]) => ({ e: store.get(k), label: l, color: c })).filter(x => x.e);
    if (sc.length) {
        const b = chartBox();
        grid.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Current"), b));
        timeChart(b, sc.map(s => ({ timestamps: s.e.timestamps, values: s.e.values, label: s.label, color: s.color })), { yLabel: "A" });
    }
    if (grid.children.length) {
        sp.appendChild(grid);
        root.appendChild(sp);
    }

    // Feeder.
    const fv = store.get("Indexer/Feeder/Inputs/velocityRadPerSec");
    const fc = store.get("Indexer/Feeder/Inputs/currentAmps");
    if (fv || fc) {
        const p = panel("Feeder", "Velocity & current");
        const grid2 = el("div", { class: "panel-grid cols-2" });
        if (fv) {
            const b = chartBox();
            grid2.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Velocity"), b));
            timeChart(b, [{ timestamps: fv.timestamps, values: fv.values, label: "Velocity", color: "#ff7a00" }], { yLabel: "rad/s" });
        }
        if (fc) {
            const b = chartBox();
            grid2.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Current"), b));
            timeChart(b, [{ timestamps: fc.timestamps, values: fc.values, label: "Current", color: "#ef4444" }], { yLabel: "A" });
        }
        p.appendChild(grid2);
        root.appendChild(p);
    }

    // Beam break.
    const bd = store.get("/Indexer/Beam/Inputs/Detected") || store.get("Indexer/Beam/Inputs/detected");
    const bdist = store.get("/Indexer/Beam/Inputs/DistanceMeters") || store.get("Indexer/Beam/Inputs/distanceMeters");
    if (bd || bdist) {
        const p = panel("Beam break", "Detected timeline & distance reading");
        if (bd) {
            const row = el("div", { class: "bool-strip-row" },
                el("div", { class: "name" }, "Detected"),
                el("div", {}),
                el("div", { class: "pct" }, fmtPct(store.trueFractionOf(bd.name))),
            );
            p.appendChild(row);
            const inner = el("div");
            row.children[1].appendChild(inner);
            boolStrip(inner, bd, { totalSec: store.durationSec, color: "#3ecf8e" });
        }
        if (bdist) {
            const b = chartBox();
            p.appendChild(el("div", { class: "panel-sub" }, "Distance (m)"));
            p.appendChild(b);
            timeChart(b, [{ timestamps: bdist.timestamps, values: bdist.values, label: "Distance", color: "#60a5fa" }], { yLabel: "m" });
        }
        root.appendChild(p);
    }

    // State flags strips.
    const flagsP = panel("Indexer state flags", "");
    const flags = [
        ["/RealOutputs/Indexer/ShouldRun", "ShouldRun", "#60a5fa"],
        ["/RealOutputs/Indexer/Jammed", "Jammed", "#ef4444"],
        ["/RealOutputs/Indexer/HasBalls", "HasBalls", "#3ecf8e"],
        ["/RealOutputs/Indexer/SpindexerStalled", "Spindexer stalled", "#f59e0b"],
        ["/RealOutputs/Indexer/FeederStalled", "Feeder stalled", "#f59e0b"],
        ["/RealOutputs/Indexer/HopperEmpty", "Hopper empty", "#5a6478"],
    ];
    let any = false;
    for (const [key, label, color] of flags) {
        const e = store.get(key);
        if (!e) continue;
        any = true;
        const row = el("div", { class: "bool-strip-row" },
            el("div", { class: "name" }, label),
            el("div", {}),
            el("div", { class: "pct" }, fmtPct(store.trueFractionOf(key))),
        );
        flagsP.appendChild(row);
        const inner = el("div");
        row.children[1].appendChild(inner);
        boolStrip(inner, e, { totalSec: store.durationSec, color });
    }
    if (any) root.appendChild(flagsP);

    if (!root.querySelector(".panel")) {
        root.appendChild(el("div", { class: "empty-note" }, "No indexer entries found in this log."));
    }
    container.appendChild(root);
}

export const meta = { id: "indexer", label: "Indexer", icon: "📦" };
