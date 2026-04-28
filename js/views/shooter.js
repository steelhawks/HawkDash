import { el, fmt, fmtPct, statCard, panel, viewHeader, chartBox, kvGrid } from "../ui.js?v=7";
import { timeChart, boolStrip } from "../charts.js?v=7";

export function render(container, store) {
    const root = el("div");
    root.appendChild(viewHeader("Shooter", "Flywheel · Hood · Turret · SOTM"));

    const ready = store.get("Flywheel/ReadyToShoot");
    const flyAtGoal = store.get("Flywheel/AimState");
    const hoodAtGoal = store.get("Hood/AtGoal");
    const turretAtGoal = store.get("Turret/AtGoal");

    const stats = el("div", { class: "stat-grid" });
    stats.appendChild(statCard("ReadyToShoot %", fmtPct(store.trueFractionOf("/RealOutputs/Flywheel/ReadyToShoot")), { cls: "good" }));
    stats.appendChild(statCard("Hood AtGoal %", fmtPct(store.trueFractionOf("/RealOutputs/Hood/AtGoal"))));
    stats.appendChild(statCard("Turret AtGoal %", fmtPct(store.trueFractionOf("/RealOutputs/Turret/AtGoal"))));
    stats.appendChild(statCard("Shots fired (rising edges)", String(store.risingEdgesOf("/RealOutputs/Flywheel/ReadyToShoot")), {
        sub: "ReadyToShoot transitions",
    }));
    // Try single-motor first, then left/right.
    const peakSingle = store.maxOf("/Flywheel/VelocityRadPerSec");
    const peakLeft = store.maxOf("/Flywheel/leftVelocityRadPerSec");
    const peakRight = store.maxOf("/Flywheel/rightVelocityRadPerSec");
    if (peakSingle != null) {
        stats.appendChild(statCard("Flywheel peak", fmt(peakSingle, 1, " rad/s")));
    } else {
        stats.appendChild(statCard("Flywheel peak L", fmt(peakLeft, 1, " rad/s")));
        stats.appendChild(statCard("Flywheel peak R", fmt(peakRight, 1, " rad/s")));
    }
    root.appendChild(stats);

    // Flywheel velocity. Real Rebuilt2026 logs have a single Flywheel/VelocityRadPerSec
    // (no L/R split) but earlier code or sims might have split motors.
    const flySingle = store.get("/Flywheel/VelocityRadPerSec");
    const flyL = store.get("/Flywheel/leftVelocityRadPerSec");
    const flyR = store.get("/Flywheel/rightVelocityRadPerSec");
    const flyTarget = store.get("/RealOutputs/Flywheel/TargetVelocity");
    if (flySingle || flyL || flyR || flyTarget) {
        const p = panel("Flywheel velocity", "Velocity vs. target (rad/s)");
        const box = chartBox({ tall: true });
        p.appendChild(box);
        const seriesList = [];
        if (flySingle) seriesList.push({ timestamps: flySingle.timestamps, values: flySingle.values, label: "Velocity", color: "#3ecf8e" });
        if (flyL) seriesList.push({ timestamps: flyL.timestamps, values: flyL.values, label: "Left", color: "#60a5fa" });
        if (flyR) seriesList.push({ timestamps: flyR.timestamps, values: flyR.values, label: "Right", color: "#3ecf8e" });
        if (flyTarget) seriesList.push({ timestamps: flyTarget.timestamps, values: flyTarget.values, label: "Target", color: "#ff7a00" });
        timeChart(box, seriesList, { yLabel: "rad/s" });

        // Voltage/current grid for flywheel.
        const grid = el("div", { class: "panel-grid cols-2" });
        const flyV = ["/Flywheel/AppliedVolts", "/Flywheel/leftAppliedVolts", "/Flywheel/rightAppliedVolts"]
            .map(k => store.get(k)).filter(Boolean);
        const dedupedV = []; const seenV = new Set();
        for (const e of flyV) if (!seenV.has(e.name)) { seenV.add(e.name); dedupedV.push(e); }
        if (dedupedV.length) {
            const b = chartBox();
            grid.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Applied voltage"), b));
            timeChart(b, dedupedV.map((e, i) => ({
                timestamps: e.timestamps, values: e.values,
                label: e.name.split("/").pop().replace(/AppliedVolts$/i, ""),
                color: ["#3ecf8e", "#60a5fa", "#ff7a00"][i % 3],
            })), { yLabel: "V" });
        }
        const flyC = ["/Flywheel/SupplyCurrentAmps", "/Flywheel/leftSupplyCurrentAmps", "/Flywheel/rightSupplyCurrentAmps"]
            .map(k => store.get(k)).filter(Boolean);
        const dedupedC = []; const seenC = new Set();
        for (const e of flyC) if (!seenC.has(e.name)) { seenC.add(e.name); dedupedC.push(e); }
        if (dedupedC.length) {
            const b = chartBox();
            grid.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Supply current"), b));
            timeChart(b, dedupedC.map((e, i) => ({
                timestamps: e.timestamps, values: e.values,
                label: e.name.split("/").pop().replace(/SupplyCurrentAmps$/i, ""),
                color: ["#3ecf8e", "#60a5fa", "#ff7a00"][i % 3],
            })), { yLabel: "A" });
        }
        if (grid.children.length) p.appendChild(grid);
        root.appendChild(p);
    }

    // Hood.
    const hoodPos = store.get("Hood/motorPositionDeg");
    const hoodGoal = store.get("Hood/goal");
    if (hoodPos || hoodGoal) {
        const p = panel("Hood angle", "Position vs. goal (degrees)");
        const box = chartBox();
        p.appendChild(box);
        const seriesList = [];
        if (hoodPos) seriesList.push({ timestamps: hoodPos.timestamps, values: hoodPos.values, label: "Position", color: "#3ecf8e" });
        if (hoodGoal) seriesList.push({ timestamps: hoodGoal.timestamps, values: hoodGoal.values, label: "Goal", color: "#ff7a00" });
        timeChart(box, seriesList, { yLabel: "deg" });
        // AtGoal strip.
        if (hoodAtGoal) {
            const stripBox = el("div", { class: "bool-strip-row" },
                el("div", { class: "name" }, "Hood AtGoal"),
                el("div", {}),
                el("div", { class: "pct" }, fmtPct(store.trueFractionOf(hoodAtGoal.name))),
            );
            p.appendChild(stripBox);
            const inner = el("div");
            stripBox.children[1].appendChild(inner);
            boolStrip(inner, hoodAtGoal, { totalSec: store.durationSec, color: "#3ecf8e" });
        }
        root.appendChild(p);
    }

    // Turret.
    const turretPos = store.get("Turret/positionRad");
    const turretGoal = store.get("Turret/GoalPosition");
    if (turretPos || turretGoal) {
        const p = panel("Turret angle", "Position vs. goal");
        const box = chartBox();
        p.appendChild(box);
        const seriesList = [];
        if (turretPos) seriesList.push({ timestamps: turretPos.timestamps, values: turretPos.values, label: "Position", color: "#3ecf8e" });
        if (turretGoal) seriesList.push({ timestamps: turretGoal.timestamps, values: turretGoal.values, label: "Goal", color: "#ff7a00" });
        timeChart(box, seriesList, { yLabel: "rad" });
        if (turretAtGoal) {
            const stripBox = el("div", { class: "bool-strip-row" },
                el("div", { class: "name" }, "Turret AtGoal"),
                el("div", {}),
                el("div", { class: "pct" }, fmtPct(store.trueFractionOf(turretAtGoal.name))),
            );
            p.appendChild(stripBox);
            const inner = el("div");
            stripBox.children[1].appendChild(inner);
            boolStrip(inner, turretAtGoal, { totalSec: store.durationSec, color: "#3ecf8e" });
        }
        // Jam / dead spot.
        const flags = [
            ["Turret/IsJammedOrDeadSpot", "Jammed or dead spot", "#ef4444"],
            ["Turret/IsAtDeadSpot", "At dead spot", "#f59e0b"],
            ["Turret/IsTraversing", "Traversing", "#60a5fa"],
        ];
        for (const [key, label, color] of flags) {
            const e = store.get(key);
            if (!e) continue;
            const row = el("div", { class: "bool-strip-row" },
                el("div", { class: "name" }, label),
                el("div", {}),
                el("div", { class: "pct" }, fmtPct(store.trueFractionOf(key))),
            );
            p.appendChild(row);
            const inner = el("div");
            row.children[1].appendChild(inner);
            boolStrip(inner, e, { totalSec: store.durationSec, color });
        }
        root.appendChild(p);
    }

    // SOTM ballistics + ShooterTuner live.
    const sotmDist = store.get("SOTM/VirtualDistance");
    const sotmTof = store.get("SOTM/TOF");
    const sotmExit = store.get("SOTM/ExitVelocity");
    const sotmHood = store.get("SOTM/HoodAngleDeg");
    if (sotmDist || sotmTof || sotmExit || sotmHood) {
        const p = panel("Shoot On The Move (SOTM)", "Computed virtual target ballistics");
        const grid = el("div", { class: "panel-grid cols-2" });
        if (sotmDist) {
            const b = chartBox();
            grid.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Virtual distance (m)"), b));
            timeChart(b, [{ timestamps: sotmDist.timestamps, values: sotmDist.values, label: "Distance", color: "#60a5fa" }], { yLabel: "m" });
        }
        if (sotmTof) {
            const b = chartBox();
            grid.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Time of flight (s)"), b));
            timeChart(b, [{ timestamps: sotmTof.timestamps, values: sotmTof.values, label: "TOF", color: "#f59e0b" }], { yLabel: "s" });
        }
        if (sotmExit) {
            const b = chartBox();
            grid.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Exit velocity"), b));
            timeChart(b, [{ timestamps: sotmExit.timestamps, values: sotmExit.values, label: "Exit", color: "#3ecf8e" }], { yLabel: "m/s" });
        }
        if (sotmHood) {
            const b = chartBox();
            grid.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Hood angle (deg)"), b));
            timeChart(b, [{ timestamps: sotmHood.timestamps, values: sotmHood.values, label: "Hood", color: "#ff7a00" }], { yLabel: "deg" });
        }
        p.appendChild(grid);
        root.appendChild(p);
    }

    // Distance to hub.
    const hubDist = store.get("Robot/DistanceToHub");
    if (hubDist) {
        const p = panel("Distance to hub", "Pose-based distance estimate");
        const box = chartBox();
        p.appendChild(box);
        timeChart(box, [{ timestamps: hubDist.timestamps, values: hubDist.values, label: "Distance", color: "#60a5fa" }], { yLabel: "m" });
        root.appendChild(p);
    }

    if (!root.querySelector(".panel")) {
        root.appendChild(el("div", { class: "empty-note" }, "No shooter entries found in this log."));
    }
    container.appendChild(root);
}

export const meta = { id: "shooter", label: "Shooter", icon: "🎯" };
