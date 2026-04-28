// uPlot chart helpers. uPlot is loaded once via dynamic import from the CDN.

let uPlotPromise = null;
function loadUPlot() {
    if (!uPlotPromise) {
        uPlotPromise = import("https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.esm.min.js")
            .then(m => m.default);
    }
    return uPlotPromise;
}

const PALETTE = [
    "#ff7a00", "#60a5fa", "#3ecf8e", "#f59e0b",
    "#c084fc", "#f472b6", "#fb923c", "#34d399",
    "#a78bfa", "#fcd34d", "#22d3ee", "#fb7185",
];

const AXIS_STYLE = {
    stroke: "#5a6478",
    grid: { stroke: "#1a1f2b", width: 1 },
    ticks: { stroke: "#1a1f2b", width: 1 },
    font: '11px ui-monospace, "SF Mono", Menlo, monospace',
};

// Resample a sparse (timestamps, values) pair so that uPlot draws stepped lines.
// uPlot needs aligned columns: a single x array, and one y array per series.
//
// We simulate "step-after" by emitting a sample at each event timestamp, optionally
// also at the start/end to pad. For multiple series, we union all timestamps
// and forward-fill each series.
export function alignSeries(seriesList) {
    // seriesList: [{ timestamps: Float64Array, values: numericArray, label }]
    if (!seriesList.length) return { x: [], ys: [] };
    // Union of timestamps.
    const tsSet = new Set();
    for (const s of seriesList) {
        for (let i = 0; i < s.timestamps.length; i++) tsSet.add(s.timestamps[i]);
    }
    const x = Array.from(tsSet).sort((a, b) => a - b);
    const ys = seriesList.map(s => {
        const out = new Array(x.length).fill(null);
        let si = 0;
        let last = null;
        for (let i = 0; i < x.length; i++) {
            while (si < s.timestamps.length && s.timestamps[si] <= x[i]) {
                last = s.values[si];
                si++;
            }
            out[i] = last;
        }
        return out;
    });
    return { x, ys };
}

// Compute a robust [lo, hi] Y range from the union of a set of value arrays.
// Uses percentile clipping (default p1..p99) plus 10% padding so a single
// startup-spike sample doesn't collapse the rest of the chart to a flat line.
function robustRange(seriesList, lowPct = 1, highPct = 99, padFactor = 0.1) {
    const flat = [];
    for (const s of seriesList) {
        const vs = s.values;
        for (let i = 0; i < vs.length; i++) {
            const v = vs[i];
            if (Number.isFinite(v)) flat.push(v);
        }
    }
    if (flat.length < 4) return null;
    flat.sort((a, b) => a - b);
    const lo = flat[Math.floor((lowPct / 100) * (flat.length - 1))];
    const hi = flat[Math.floor((highPct / 100) * (flat.length - 1))];
    if (!(hi > lo)) return null;
    const pad = Math.max(1e-9, (hi - lo) * padFactor);
    return [lo - pad, hi + pad];
}

export async function timeChart(container, seriesList, opts = {}) {
    const uPlot = await loadUPlot();
    if (!seriesList.length) {
        container.innerHTML = '<div class="empty-note">No data for this entry.</div>';
        return null;
    }
    const { x, ys } = alignSeries(seriesList);
    if (!x.length) {
        container.innerHTML = '<div class="empty-note">No samples.</div>';
        return null;
    }
    const series = [
        { label: "t (s)" },
        ...seriesList.map((s, i) => ({
            label: s.label,
            stroke: s.color || PALETTE[i % PALETTE.length],
            width: 1.5,
            points: { show: false },
            spanGaps: true,
        })),
    ];
    const data = [x, ...ys];

    // Compute the robust range up-front so we can switch to it on demand.
    const robust = opts.robust ? robustRange(seriesList) : null;
    const initialYRange = opts.yRange || robust || null;

    const rect = container.getBoundingClientRect();
    const plot = new uPlot({
        width: Math.max(rect.width, 200),
        height: opts.height || rect.height || 240,
        series,
        scales: {
            x: { time: false },
            // If we have an initial range, set it as a static range function. uPlot
            // calls scale.range every layout; returning fixed values keeps the
            // robust-clipped view stable until the user toggles it off.
            y: initialYRange
                ? { range: () => [initialYRange[0], initialYRange[1]] }
                : {},
        },
        axes: [
            { ...AXIS_STYLE, values: (u, vs) => vs.map(v => v.toFixed(1) + "s") },
            { ...AXIS_STYLE, label: opts.yLabel || "" },
        ],
        legend: { show: opts.legend !== false },
        cursor: {
            // Drag-zoom on both axes; double-click resets.
            drag: { x: true, y: true },
        },
    }, data, container);

    const ro = new ResizeObserver(() => {
        const r = container.getBoundingClientRect();
        plot.setSize({ width: r.width, height: r.height });
    });
    ro.observe(container);

    // Track which Y mode the chart is in so reset / wheel work correctly.
    const xData = data[0];
    const xDataMin = xData[0];
    const xDataMax = xData[xData.length - 1];
    let yMode = robust ? "robust" : "auto";
    const applyYMode = () => {
        if (yMode === "robust" && robust) {
            plot.scales.y.range = () => [robust[0], robust[1]];
        } else {
            plot.scales.y.range = (u, dataMin, dataMax) => [dataMin, dataMax];
        }
    };

    container.style.position = container.style.position || "relative";

    // Wheel zoom on X centered at the cursor; ctrl/meta + wheel = Y zoom.
    plot.over.addEventListener("wheel", (e) => {
        e.preventDefault();
        const rect = plot.over.getBoundingClientRect();
        const factor = e.deltaY > 0 ? 1.25 : 1 / 1.25;
        if (e.ctrlKey || e.metaKey) {
            const py = e.clientY - rect.top;
            const yMin = plot.scales.y.min, yMax = plot.scales.y.max;
            if (yMin == null || yMax == null) return;
            const cy = plot.posToVal(py, "y");
            plot.scales.y.range = () => [cy - (cy - yMin) * factor, cy + (yMax - cy) * factor];
            yMode = "manual";
            plot.redraw();
        } else {
            const px = e.clientX - rect.left;
            const xMin = plot.scales.x.min, xMax = plot.scales.x.max;
            if (xMin == null || xMax == null) return;
            const cx = plot.posToVal(px, "x");
            const newMin = cx - (cx - xMin) * factor;
            const newMax = cx + (xMax - cx) * factor;
            plot.setScale("x", { min: newMin, max: newMax });
        }
    }, { passive: false });

    // Shift+drag (or middle-button drag) pans X.
    let panning = false, panStartX = 0, panStartXMin = 0, panStartXMax = 0;
    plot.over.addEventListener("mousedown", (e) => {
        if (!(e.shiftKey || e.button === 1)) return;
        e.preventDefault();
        e.stopPropagation();
        panning = true;
        panStartX = e.clientX;
        panStartXMin = plot.scales.x.min;
        panStartXMax = plot.scales.x.max;
        plot.over.style.cursor = "grabbing";
    });
    const onMove = (e) => {
        if (!panning) return;
        const rect = plot.over.getBoundingClientRect();
        const dx = e.clientX - panStartX;
        const range = panStartXMax - panStartXMin;
        const dval = (dx / rect.width) * range;
        plot.setScale("x", { min: panStartXMin - dval, max: panStartXMax - dval });
    };
    const onUp = () => { if (panning) { panning = false; plot.over.style.cursor = ""; } };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    // Double-click resets both axes to full data range (or robust on Y).
    plot.over.addEventListener("dblclick", () => {
        plot.setScale("x", { min: xDataMin, max: xDataMax });
        yMode = robust ? "robust" : "auto";
        applyYMode();
        plot.redraw();
        if (rangeBtn) rangeBtn.textContent = robust ? "Show full range" : "Reset Y";
    });

    // Reset button — always present, visible at all times.
    const resetBtn = document.createElement("button");
    resetBtn.className = "chart-range-btn chart-reset-btn";
    resetBtn.type = "button";
    resetBtn.textContent = "↺ reset";
    resetBtn.title = "Reset zoom & pan. Same as double-click.";
    resetBtn.addEventListener("click", () => {
        plot.setScale("x", { min: xDataMin, max: xDataMax });
        yMode = robust ? "robust" : "auto";
        applyYMode();
        plot.redraw();
        if (rangeBtn) rangeBtn.textContent = robust ? "Show full range" : "Reset Y";
    });
    container.appendChild(resetBtn);

    // Robust toggle (only when robust mode is active).
    let rangeBtn = null;
    if (robust) {
        rangeBtn = document.createElement("button");
        rangeBtn.className = "chart-range-btn chart-range-toggle";
        rangeBtn.type = "button";
        rangeBtn.textContent = "Show full range";
        rangeBtn.title = `Robust range clips Y to p1..p99 (${robust[0].toFixed(2)} .. ${robust[1].toFixed(2)}). Click to show min..max.`;
        rangeBtn.addEventListener("click", () => {
            yMode = yMode === "robust" ? "auto" : "robust";
            applyYMode();
            rangeBtn.textContent = yMode === "robust" ? "Show full range" : "Show robust range";
            plot.redraw();
        });
        container.appendChild(rangeBtn);
    }

    // Help hint pinned to the corner; shows controls on hover.
    const helpHint = document.createElement("div");
    helpHint.className = "chart-help";
    helpHint.textContent = "?";
    helpHint.title = "Drag = zoom to box · Wheel = zoom X (Ctrl/Cmd+Wheel = zoom Y) · Shift+Drag = pan · Double-click or ↺ = reset";
    container.appendChild(helpHint);

    return plot;
}

// Boolean strip chart: a horizontal bar that's "on" colored where the bool is true.
export function boolStrip(container, entry, opts = {}) {
    container.innerHTML = "";
    if (!entry || entry.kind !== "boolean" || entry.count === 0) {
        container.classList.add("empty");
        return;
    }
    const total = opts.totalSec || entry.timestamps[entry.count - 1] || 1;
    const wrap = document.createElement("div");
    wrap.className = "bool-strip";
    container.appendChild(wrap);

    let trueTime = 0;
    for (let i = 0; i < entry.count; i++) {
        const t0 = entry.timestamps[i];
        const t1 = i + 1 < entry.count ? entry.timestamps[i + 1] : total;
        if (entry.values[i]) {
            trueTime += t1 - t0;
            const seg = document.createElement("div");
            seg.style.position = "absolute";
            seg.style.top = "0";
            seg.style.bottom = "0";
            seg.style.left = (t0 / total * 100).toFixed(3) + "%";
            seg.style.width = ((t1 - t0) / total * 100).toFixed(3) + "%";
            seg.style.background = opts.color || "#3ecf8e";
            seg.style.opacity = "0.85";
            wrap.appendChild(seg);
        }
    }
    return { trueTime, fraction: total > 0 ? trueTime / total : 0 };
}

// Convenience: build a single time chart from a single LogStore entry.
export async function entryChart(container, entry, opts = {}) {
    if (!entry) {
        container.innerHTML = '<div class="empty-note">Entry not in this log.</div>';
        return;
    }
    if (entry.kind === "boolean") {
        const out = await timeChart(container, [{
            timestamps: entry.timestamps,
            values: entry.values,
            label: opts.label || entry.name,
            color: opts.color,
        }], { ...opts, yRange: [-0.1, 1.1] });
        return out;
    }
    if (entry.kind !== "numeric") {
        container.innerHTML = '<div class="empty-note">Entry is not numeric.</div>';
        return;
    }
    return timeChart(container, [{
        timestamps: entry.timestamps,
        values: entry.values,
        label: opts.label || entry.name,
        color: opts.color,
    }], opts);
}

export const chartPalette = PALETTE;
