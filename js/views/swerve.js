import { el, fmt, fmtPct, statCard, panel, viewHeader, chartBox } from "../ui.js";
import { timeChart, boolStrip, chartPalette } from "../charts.js";

const MODULES = [0, 1, 2, 3];

export function render(container, store) {
    const root = el("div");
    root.appendChild(viewHeader("Swerve", "Modules · Gyro · Chassis speeds · Collision"));

    const stats = el("div", { class: "stat-grid" });
    let peakDriveAmps = 0;
    for (const i of MODULES) {
        const v = store.maxOf(`Swerve/Module${i}/driveCurrentAmps`);
        if (v && v > peakDriveAmps) peakDriveAmps = v;
    }
    stats.appendChild(statCard("Peak drive current", fmt(peakDriveAmps, 1, " A"), { cls: peakDriveAmps > 60 ? "bad" : "" }));
    let peakDriveVel = 0;
    for (const i of MODULES) {
        const v = store.maxOf(`Swerve/Module${i}/driveVelocityRadPerSec`);
        if (v && v > peakDriveVel) peakDriveVel = v;
    }
    stats.appendChild(statCard("Peak module velocity", fmt(peakDriveVel, 1, " rad/s")));
    stats.appendChild(statCard("Slow mode %", fmtPct(store.trueFractionOf("Swerve/Is Slow Mode"))));
    stats.appendChild(statCard("Collisions", String(store.risingEdgesOf("Swerve/Collision/Detected")), { cls: "bad" }));
    stats.appendChild(statCard("On bump %", fmtPct(store.trueFractionOf("Swerve/IsOnBump"))));
    stats.appendChild(statCard("Align AtGoal %", fmtPct(store.trueFractionOf("Swerve/AlignAtGoal"))));

    const peakAccel = store.maxOf("Swerve/Gyro/AccelerationInGs");
    stats.appendChild(statCard("Peak acceleration", fmt(peakAccel, 2, " G"), { cls: "warn" }));
    root.appendChild(stats);

    // Module velocities.
    const velP = panel("Module drive velocity", "rad/s, all 4 modules");
    const velBox = chartBox({ tall: true });
    velP.appendChild(velBox);
    const velSeries = MODULES.map(i => store.get(`Swerve/Module${i}/driveVelocityRadPerSec`))
        .map((e, i) => e ? { timestamps: e.timestamps, values: e.values, label: `Module ${i}`, color: chartPalette[i] } : null)
        .filter(Boolean);
    if (velSeries.length) timeChart(velBox, velSeries, { yLabel: "rad/s" });
    root.appendChild(velP);

    // Module drive currents.
    const curP = panel("Module drive current", "A, all 4 modules");
    const curBox = chartBox({ tall: true });
    curP.appendChild(curBox);
    const curSeries = MODULES.map(i => store.get(`Swerve/Module${i}/driveCurrentAmps`))
        .map((e, i) => e ? { timestamps: e.timestamps, values: e.values, label: `Module ${i}`, color: chartPalette[i] } : null)
        .filter(Boolean);
    if (curSeries.length) timeChart(curBox, curSeries, { yLabel: "A" });
    root.appendChild(curP);

    // Turn currents.
    const tCurP = panel("Module turn current", "A");
    const tCurBox = chartBox();
    tCurP.appendChild(tCurBox);
    const tCurSeries = MODULES.map(i => store.get(`Swerve/Module${i}/turnCurrentAmps`))
        .map((e, i) => e ? { timestamps: e.timestamps, values: e.values, label: `Module ${i}`, color: chartPalette[i] } : null)
        .filter(Boolean);
    if (tCurSeries.length) timeChart(tCurBox, tCurSeries, { yLabel: "A" });
    root.appendChild(tCurP);

    // Module temperatures.
    const tempP = panel("Module temperatures", "Drive + turn temperatures (°C)");
    const tempBox = chartBox();
    tempP.appendChild(tempBox);
    const tempSeries = [];
    for (const i of MODULES) {
        const d = store.get(`Swerve/Module${i}/driveTempCelsius`);
        const t = store.get(`Swerve/Module${i}/turnTempCelsius`);
        if (d) tempSeries.push({ timestamps: d.timestamps, values: d.values, label: `M${i} drive`, color: chartPalette[i * 2 % chartPalette.length] });
        if (t) tempSeries.push({ timestamps: t.timestamps, values: t.values, label: `M${i} turn`, color: chartPalette[(i * 2 + 1) % chartPalette.length] });
    }
    if (tempSeries.length) timeChart(tempBox, tempSeries, { yLabel: "°C" });
    if (tempSeries.length) root.appendChild(tempP);

    // Gyro.
    const ax = store.get("Swerve/Gyro/accelerationXInGs");
    const ay = store.get("Swerve/Gyro/accelerationYInGs");
    const yawV = store.get("Swerve/Gyro/yawVelocityRadPerSec");
    const accelMag = store.get("Swerve/Gyro/AccelerationInGs");
    if (ax || ay || yawV || accelMag) {
        const p = panel("Gyro", "Acceleration and yaw rate");
        const grid = el("div", { class: "panel-grid cols-2" });
        if (ax || ay || accelMag) {
            const b = chartBox();
            const series = [];
            if (ax) series.push({ timestamps: ax.timestamps, values: ax.values, label: "X (G)", color: "#60a5fa" });
            if (ay) series.push({ timestamps: ay.timestamps, values: ay.values, label: "Y (G)", color: "#3ecf8e" });
            if (accelMag) series.push({ timestamps: accelMag.timestamps, values: accelMag.values, label: "|a| (G)", color: "#ff7a00" });
            grid.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Acceleration (G)"), b));
            timeChart(b, series, { yLabel: "G" });
        }
        if (yawV) {
            const b = chartBox();
            grid.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Yaw rate"), b));
            timeChart(b, [{ timestamps: yawV.timestamps, values: yawV.values, label: "yaw rate", color: "#c084fc" }], { yLabel: "rad/s" });
        }
        p.appendChild(grid);
        root.appendChild(p);
    }

    // Collision metrics.
    const jerk = store.get("Swerve/Collision/JerkMagnitude");
    const cmdAccel = store.get("Swerve/Collision/CommandedAccelMagnitude");
    const angJerk = store.get("Swerve/Collision/AngularJerkMagnitude");
    const detected = store.get("Swerve/Collision/Detected");
    if (jerk || cmdAccel || angJerk || detected) {
        const p = panel("Collision detection", "Jerk magnitudes and detection");
        const grid = el("div", { class: "panel-grid cols-2" });
        if (jerk || cmdAccel) {
            const b = chartBox();
            const s = [];
            if (jerk) s.push({ timestamps: jerk.timestamps, values: jerk.values, label: "Jerk", color: "#ef4444" });
            if (cmdAccel) s.push({ timestamps: cmdAccel.timestamps, values: cmdAccel.values, label: "Cmd accel", color: "#f59e0b" });
            grid.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Linear"), b));
            timeChart(b, s, {});
        }
        if (angJerk) {
            const b = chartBox();
            grid.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Angular jerk"), b));
            timeChart(b, [{ timestamps: angJerk.timestamps, values: angJerk.values, label: "Angular jerk", color: "#c084fc" }], {});
        }
        p.appendChild(grid);
        if (detected) {
            const row = el("div", { class: "bool-strip-row" },
                el("div", { class: "name" }, "Detected"),
                el("div", {}),
                el("div", { class: "pct" }, fmtPct(store.trueFractionOf(detected.name))),
            );
            p.appendChild(row);
            const inner = el("div");
            row.children[1].appendChild(inner);
            boolStrip(inner, detected, { totalSec: store.durationSec, color: "#ef4444" });
        }
        root.appendChild(p);
    }

    if (!root.querySelector(".panel")) {
        root.appendChild(el("div", { class: "empty-note" }, "No swerve entries found in this log."));
    }
    container.appendChild(root);
}

export const meta = { id: "swerve", label: "Swerve", icon: "🛞" };
