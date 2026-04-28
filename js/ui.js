// Tiny DOM / formatting helpers shared by views.

export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
    }
    for (const c of children) {
        if (c == null) continue;
        if (typeof c === "string" || typeof c === "number") node.appendChild(document.createTextNode(String(c)));
        else node.appendChild(c);
    }
    return node;
}

export function fmt(value, digits = 2, suffix = "") {
    if (value == null || !Number.isFinite(value)) return "—";
    return value.toFixed(digits) + suffix;
}

export function fmtInt(value) {
    if (value == null || !Number.isFinite(value)) return "—";
    return Math.round(value).toLocaleString();
}

export function fmtPct(value, digits = 1) {
    if (value == null || !Number.isFinite(value)) return "—";
    return (value * 100).toFixed(digits) + "%";
}

export function fmtTime(secs) {
    if (!Number.isFinite(secs)) return "—";
    const m = Math.floor(secs / 60);
    const s = secs - m * 60;
    return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export function statCard(label, value, opts = {}) {
    return el("div", { class: "stat-card" },
        el("div", { class: "stat-label" }, label),
        el("div", { class: "stat-value" + (opts.cls ? " " + opts.cls : "") }, value),
        opts.sub ? el("div", { class: "stat-sub" }, opts.sub) : null,
    );
}

export function panel(title, sub, body) {
    const p = el("div", { class: "panel" });
    if (title) {
        const head = el("div", { class: "panel-header" },
            el("div", { class: "panel-title" }, title),
            sub ? el("div", { class: "panel-sub" }, sub) : null,
        );
        p.appendChild(head);
    }
    if (body) {
        if (Array.isArray(body)) for (const b of body) p.appendChild(b);
        else p.appendChild(body);
    }
    return p;
}

export function kvGrid(pairs) {
    const g = el("div", { class: "kv-grid" });
    for (const [k, v] of pairs) {
        g.appendChild(el("div", { class: "k" }, k));
        g.appendChild(el("div", { class: "v" }, v == null ? "—" : String(v)));
    }
    return g;
}

export function viewHeader(title, sub) {
    return el("div", { class: "view-header" },
        el("h2", {}, title),
        sub ? el("div", { class: "view-sub" }, sub) : null,
    );
}

export function chartBox(opts = {}) {
    const cls = "chart-box" + (opts.tall ? " tall" : "") + (opts.short ? " short" : "");
    return el("div", { class: cls });
}

export function bar(label, value, max, format) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    const fmtVal = format ? format(value) : (value == null ? "—" : value.toFixed(2));
    const row = el("div", { class: "bar-row" },
        el("div", { class: "name" }, label),
        el("div", { class: "bar" }, el("div", { class: "bar-fill" })),
        el("div", { class: "val" }, fmtVal),
    );
    row.querySelector(".bar-fill").style.width = pct + "%";
    return row;
}
