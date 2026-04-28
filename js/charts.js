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
    const rect = container.getBoundingClientRect();
    const plot = new uPlot({
        width: Math.max(rect.width, 200),
        height: opts.height || rect.height || 240,
        series,
        scales: {
            x: { time: false },
            y: opts.yRange ? { range: opts.yRange } : {},
        },
        axes: [
            { ...AXIS_STYLE, values: (u, vs) => vs.map(v => v.toFixed(1) + "s") },
            { ...AXIS_STYLE, label: opts.yLabel || "" },
        ],
        legend: { show: opts.legend !== false },
        cursor: {
            drag: { x: true, y: false },
        },
    }, data, container);

    const ro = new ResizeObserver(() => {
        const r = container.getBoundingClientRect();
        plot.setSize({ width: r.width, height: r.height });
    });
    ro.observe(container);
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
