import { el, fmt, fmtInt, fmtPct, fmtTime, statCard, panel, viewHeader, kvGrid, chartBox } from "../ui.js";
import { entryChart, timeChart } from "../charts.js";

function modeFromDS(store) {
    const enabled = store.get("/DriverStation/Enabled");
    const auto = store.get("/DriverStation/Autonomous");
    if (!enabled) return null;
    return { enabled, auto };
}

export function render(container, store) {
    const root = el("div");

    // Header.
    const fileName = store.parsed.fileName || "log";
    root.appendChild(viewHeader("Overview", `${fileName} · ${fmt(store.durationSec, 1, "s")} duration · ${fmtInt(store.parsed.totalRecords)} records · ${store.entries.size} entries`));

    // Top stat cards.
    const stats = el("div", { class: "stat-grid" });
    // AllianceStation is int64 (1-3 = Red 1-3, 4-6 = Blue 1-3).
    const allianceStation = store.lastOf("/DriverStation/AllianceStation");
    const alliance = store.lastOf("/DriverStation/Alliance")
        || (allianceStation != null ? (allianceStation <= 3 ? "Red" : "Blue") : null);
    const station = allianceStation != null ? `${alliance} ${((allianceStation - 1) % 3) + 1}` : null;
    const event = store.lastOf("/DriverStation/EventName");
    // MatchType: 0=None, 1=Practice, 2=Qual, 3=Elim.
    const matchTypeRaw = store.lastOf("/DriverStation/MatchType");
    const matchTypeStr = matchTypeRaw === 1 ? "Practice"
        : matchTypeRaw === 2 ? "Qual"
        : matchTypeRaw === 3 ? "Elim"
        : (typeof matchTypeRaw === "string" ? matchTypeRaw : null);
    const matchNumber = store.lastOf("/DriverStation/MatchNumber");
    const enabled = store.get("/DriverStation/Enabled");
    const auto = store.get("/DriverStation/Autonomous");
    const fms = store.lastOf("/DriverStation/FmsAttached") ?? store.lastOf("/DriverStation/FMSAttached");

    let enabledFrac = enabled ? store.trueFractionOf("/DriverStation/Enabled") : null;
    let autoFrac = auto ? store.trueFractionOf("/DriverStation/Autonomous") : null;
    let teleFrac = (enabledFrac != null && autoFrac != null) ? Math.max(0, enabledFrac - autoFrac) : null;

    stats.appendChild(statCard("Duration", fmtTime(store.durationSec)));
    stats.appendChild(statCard("Alliance", station || alliance || "—",
        { cls: alliance === "Red" ? "bad" : alliance === "Blue" ? "" : "" }));
    stats.appendChild(statCard("Event", event || "—"));
    stats.appendChild(statCard("Match", matchTypeStr && matchNumber ? `${matchTypeStr} ${matchNumber}` : "—"));
    stats.appendChild(statCard("FMS Connected", fms === true ? "Yes" : fms === false ? "No" : "—",
        { cls: fms === true ? "good" : "" }));
    stats.appendChild(statCard("Enabled time", fmtPct(enabledFrac), { sub: enabledFrac != null ? fmt(enabledFrac * store.durationSec, 1, "s") : null }));
    stats.appendChild(statCard("Autonomous", fmtPct(autoFrac), { sub: autoFrac != null ? fmt(autoFrac * store.durationSec, 1, "s") : null }));
    stats.appendChild(statCard("Teleop", fmtPct(teleFrac), { sub: teleFrac != null ? fmt(teleFrac * store.durationSec, 1, "s") : null }));
    root.appendChild(stats);

    // Robot mode timeline.
    if (enabled || auto) {
        const p = panel("Robot mode timeline", "DriverStation enabled / autonomous flags over time");
        const box = chartBox();
        p.appendChild(box);
        root.appendChild(p);
        const seriesList = [];
        if (enabled) seriesList.push({ timestamps: enabled.timestamps, values: enabled.values, label: "Enabled", color: "#3ecf8e" });
        if (auto) seriesList.push({ timestamps: auto.timestamps, values: auto.values, label: "Autonomous", color: "#ff7a00" });
        if (fms != null) {
            const f = store.get("/DriverStation/FmsAttached");
            if (f) seriesList.push({ timestamps: f.timestamps, values: f.values, label: "FMS", color: "#60a5fa" });
        }
        timeChart(box, seriesList, { yRange: [-0.1, 1.1], yLabel: "" });
    }

    // Robot state custom (from RobotState.java).
    const robotState = store.get("RobotState");
    if (robotState && robotState.count > 0) {
        const p = panel("Robot state", "Custom RobotState log (DISABLED / TELEOP / AUTON / TEST)");
        const last = robotState.values[robotState.count - 1];
        p.appendChild(el("div", { class: "stat-card" },
            el("div", { class: "stat-label" }, "Final state"),
            el("div", { class: "stat-value accent" }, String(last)),
        ));
        root.appendChild(p);
    }

    // Pose estimation distance traveled.
    const pose = store.get("/RealOutputs/RobotState/PoseEstimation/PoseEstimation")
        || store.get("/RealOutputs/RobotState/EstimatedPose")
        || store.get("RobotState/PoseEstimation/PoseEstimation");
    if (pose && pose.count > 1 && typeof pose.values[0] === "object") {
        let dist = 0;
        for (let i = 1; i < pose.count; i++) {
            const a = pose.values[i - 1], b = pose.values[i];
            if (a && b && typeof a.x === "number" && typeof b.x === "number") {
                dist += Math.hypot(b.x - a.x, b.y - a.y);
            }
        }
        const last = pose.values[pose.count - 1];
        const p = panel("Pose estimation", "From RobotState/PoseEstimation");
        p.appendChild(kvGrid([
            ["Distance traveled", fmt(dist, 2, " m")],
            ["Final X", last && fmt(last.x, 2, " m")],
            ["Final Y", last && fmt(last.y, 2, " m")],
            ["Final heading", last && fmt(last.rot * 180 / Math.PI, 1, "°")],
        ]));
        root.appendChild(p);
    }

    container.appendChild(root);
}

export const meta = { id: "overview", label: "Overview", icon: "🏁" };
