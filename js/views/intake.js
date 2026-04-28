import { el, fmtPct, statCard, panel, viewHeader, chartBox, fmt } from "../ui.js";
import { timeChart, boolStrip } from "../charts.js";

export function render(container, store) {
    const root = el("div");
    root.appendChild(viewHeader("Intake", "Rack actuators and roller"));

    const stats = el("div", { class: "stat-grid" });
    stats.appendChild(statCard("AtGoal %", fmtPct(store.trueFractionOf("Intake/AtGoal")), { cls: "good" }));
    stats.appendChild(statCard("Stalling %", fmtPct(store.trueFractionOf("Intake/IsStalling")), { cls: "bad" }));
    stats.appendChild(statCard("Twisting %", fmtPct(store.trueFractionOf("Intake/IsTwisting")), { cls: "warn" }));
    stats.appendChild(statCard("Stall events", String(store.risingEdgesOf("Intake/IsStalling")), { cls: "bad" }));
    const homed = store.get("Intake/IsHomed");
    if (homed) stats.appendChild(statCard("Homed", store.lastOf(homed.name) ? "Yes" : "No", { cls: store.lastOf(homed.name) ? "good" : "bad" }));
    root.appendChild(stats);

    // Rack positions.
    const lp = store.get("Intake/leftPositionMeters");
    const rp = store.get("Intake/rightPositionMeters");
    const goal = store.get("Intake/goal");
    if (lp || rp || goal) {
        const p = panel("Rack position", "Left / right rack vs. goal");
        const box = chartBox();
        p.appendChild(box);
        const seriesList = [];
        if (lp) seriesList.push({ timestamps: lp.timestamps, values: lp.values, label: "Left", color: "#60a5fa" });
        if (rp) seriesList.push({ timestamps: rp.timestamps, values: rp.values, label: "Right", color: "#3ecf8e" });
        if (goal) seriesList.push({ timestamps: goal.timestamps, values: goal.values, label: "Goal", color: "#ff7a00" });
        timeChart(box, seriesList, { yLabel: "m" });
        root.appendChild(p);
    }

    // Currents.
    const lc = store.get("Intake/leftSupplyCurrentAmps");
    const rc = store.get("Intake/rightSupplyCurrentAmps");
    const ic = store.get("Intake/intakeSupplyCurrentAmps");
    if (lc || rc || ic) {
        const p = panel("Intake currents", "Supply current per motor");
        const box = chartBox();
        p.appendChild(box);
        const seriesList = [];
        if (lc) seriesList.push({ timestamps: lc.timestamps, values: lc.values, label: "Left", color: "#60a5fa" });
        if (rc) seriesList.push({ timestamps: rc.timestamps, values: rc.values, label: "Right", color: "#3ecf8e" });
        if (ic) seriesList.push({ timestamps: ic.timestamps, values: ic.values, label: "Roller", color: "#ff7a00" });
        timeChart(box, seriesList, { yLabel: "A" });
        root.appendChild(p);
    }

    // Roller velocity.
    const rv = store.get("Intake/intakeVelocityRadPerSec");
    if (rv) {
        const p = panel("Roller velocity", "rad/s");
        const box = chartBox();
        p.appendChild(box);
        timeChart(box, [{ timestamps: rv.timestamps, values: rv.values, label: "Roller", color: "#ff7a00" }], { yLabel: "rad/s" });
        root.appendChild(p);
    }

    // State strips.
    const flagsP = panel("Intake state flags", "");
    const flags = [
        ["Intake/AtGoal", "AtGoal", "#3ecf8e"],
        ["Intake/IsStalling", "IsStalling", "#ef4444"],
        ["Intake/IsTwisting", "IsTwisting", "#f59e0b"],
        ["Intake/ShouldRun", "ShouldRun", "#60a5fa"],
        ["Intake/IsHomed", "IsHomed", "#3ecf8e"],
        ["Intake/Zeroed", "Zeroed", "#3ecf8e"],
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

    // Temperature peaks.
    const temps = ["Intake/leftTempCelsius", "Intake/rightTempCelsius", "Intake/intakeTempCelsius"]
        .map(k => ({ k, e: store.get(k) })).filter(x => x.e);
    if (temps.length) {
        const p = panel("Motor temperatures", "Celsius");
        const box = chartBox();
        p.appendChild(box);
        timeChart(box, temps.map(({ k, e }, i) => ({
            timestamps: e.timestamps, values: e.values,
            label: k.split("/").pop().replace("TempCelsius", ""),
            color: ["#60a5fa", "#3ecf8e", "#ff7a00"][i % 3],
        })), { yLabel: "°C" });
        root.appendChild(p);
    }

    if (!root.querySelector(".panel")) {
        root.appendChild(el("div", { class: "empty-note" }, "No intake entries found in this log."));
    }
    container.appendChild(root);
}

export const meta = { id: "intake", label: "Intake", icon: "🍳" };
