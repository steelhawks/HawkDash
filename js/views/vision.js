import { el, fmt, fmtInt, fmtPct, statCard, panel, viewHeader, chartBox, kvGrid } from "../ui.js";
import { timeChart, boolStrip, chartPalette } from "../charts.js";

// Discover Vision/{name}/Connected entries (case-insensitive). The robot uses
// camera names like "ardu-back-left", "ardu-front-right", etc.
function listCameras(store) {
    const re = /^\/?Vision\/([^\/]+)\/Connected$/i;
    const out = [];
    for (const e of store.entries.values()) {
        const m = re.exec(e.name);
        if (m && e.kind === "boolean") out.push(m[1]);
    }
    return out;
}

function listObjectCameras(store) {
    const re = /^\/?ObjectVision\/([^\/]+)\/Connected$/i;
    const out = [];
    for (const e of store.entries.values()) {
        const m = re.exec(e.name);
        if (m && e.kind === "boolean") out.push(m[1]);
    }
    return out;
}

// Tag count over time per camera, derived from /Vision/{cam}/TagIds (int64[]).
function tagCountSeries(store, cam) {
    const e = store.get(`/Vision/${cam}/TagIds`);
    if (!e || e.kind !== "object") return null;
    const ts = new Float64Array(e.count);
    const vs = new Float64Array(e.count);
    for (let i = 0; i < e.count; i++) {
        ts[i] = e.timestamps[i];
        const arr = e.values[i];
        vs[i] = arr ? arr.length : 0;
    }
    return { timestamps: ts, values: vs };
}

// Sum the lengths of pose array entries to estimate total accepted/rejected counts.
function poseArrayTotal(store, suffix) {
    let total = 0;
    const re = new RegExp(`^\\/?(?:RealOutputs|ReplayOutputs)?\\/?Vision\\/.+?\\/${suffix}$`, "i");
    for (const e of store.entries.values()) {
        if (!re.test(e.name) || e.kind !== "object") continue;
        for (let i = 0; i < e.count; i++) {
            const v = e.values[i];
            if (Array.isArray(v)) total += v.length;
        }
    }
    return total;
}

export function render(container, store) {
    const root = el("div");
    root.appendChild(viewHeader("Vision", "AprilTag cameras and object detection"));

    const cameras = listCameras(store);
    const objCams = listObjectCameras(store);

    const accepted = poseArrayTotal(store, "RobotPosesAccepted");
    const rejected = poseArrayTotal(store, "RobotPosesRejected");
    const total = accepted + rejected;
    const stats = el("div", { class: "stat-grid" });
    stats.appendChild(statCard("Cameras", String(cameras.length), { sub: cameras.join(", ") || "—" }));
    if (objCams.length) stats.appendChild(statCard("Object cameras", String(objCams.length), { sub: objCams.join(", ") || "—" }));
    stats.appendChild(statCard("Accepted poses", fmtInt(accepted), { cls: "good" }));
    stats.appendChild(statCard("Rejected poses", fmtInt(rejected), { cls: "bad" }));
    stats.appendChild(statCard("Acceptance rate", total ? fmtPct(accepted / total) : "—"));
    root.appendChild(stats);

    // Per-camera connection strip + tag count chart.
    if (cameras.length) {
        const p = panel("Camera connection", "Green = connected. Length of TagIds array charts how many tags each camera saw.");
        for (const cam of cameras) {
            const e = store.get(`/Vision/${cam}/Connected`);
            const row = el("div", { class: "bool-strip-row" },
                el("div", { class: "name" }, cam),
                el("div", {}),
                el("div", { class: "pct" }, e ? fmtPct(store.trueFractionOf(e.name)) : "—"),
            );
            p.appendChild(row);
            const stripBox = el("div");
            row.children[1].appendChild(stripBox);
            boolStrip(stripBox, e, { totalSec: store.durationSec, color: "#3ecf8e" });
        }
        root.appendChild(p);

        // Tag count combined chart.
        const tagP = panel("Tags visible per camera", "Length of /Vision/{cam}/TagIds over time");
        const box = chartBox({ tall: true });
        tagP.appendChild(box);
        const seriesList = cameras.map((cam, i) => {
            const s = tagCountSeries(store, cam);
            return s ? { timestamps: s.timestamps, values: s.values, label: cam, color: chartPalette[i % chartPalette.length] } : null;
        }).filter(Boolean);
        if (seriesList.length) {
            timeChart(box, seriesList, { yLabel: "tags" });
            root.appendChild(tagP);
        }
    }

    // QuestNav block (if logged).
    const qConn = store.get("/RealOutputs/QuestNav/Connected") || store.get("QuestNav/Connected");
    const qTrack = store.get("/RealOutputs/QuestNav/Tracking") || store.get("QuestNav/Tracking");
    const qBatt = store.get("/RealOutputs/QuestNav/Battery") || store.get("QuestNav/Battery");
    const qLat = store.get("/RealOutputs/QuestNav/Latency") || store.get("QuestNav/Latency");
    if (qConn || qTrack || qBatt || qLat) {
        const p = panel("QuestNav", "Oculus Quest pose estimator");
        const grid = el("div", { class: "panel-grid cols-2" });
        if (qBatt) {
            const box = chartBox();
            grid.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Battery (%)"), box));
            timeChart(box, [{ timestamps: qBatt.timestamps, values: qBatt.values, label: "Battery", color: "#3ecf8e" }], { yLabel: "%" });
        }
        if (qLat) {
            const box = chartBox();
            grid.appendChild(el("div", {}, el("div", { class: "panel-sub" }, "Latency (s)"), box));
            timeChart(box, [{ timestamps: qLat.timestamps, values: qLat.values, label: "Latency", color: "#f59e0b" }], { yLabel: "s" });
        }
        p.appendChild(grid);
        const kvs = [];
        if (qConn) kvs.push(["Connected fraction", fmtPct(store.trueFractionOf(qConn.name))]);
        if (qTrack) kvs.push(["Tracking fraction", fmtPct(store.trueFractionOf(qTrack.name))]);
        const fc = store.get("/RealOutputs/QuestNav/FrameCount") || store.get("QuestNav/FrameCount");
        if (fc) kvs.push(["Final frame count", fmtInt(store.lastOf(fc.name))]);
        if (kvs.length) p.appendChild(kvGrid(kvs));
        root.appendChild(p);
    }

    if (!root.querySelector(".panel")) {
        root.appendChild(el("div", { class: "empty-note" }, "No vision entries found in this log."));
    }
    container.appendChild(root);
}

export const meta = { id: "vision", label: "Vision", icon: "👁" };
