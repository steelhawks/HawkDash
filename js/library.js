import {
    listLogs,
    downloadLogBlob,
    getPublicUrl,
    deleteLog,
    isReady,
} from "./supabase.js?v=1";
import { PRESET_EVENT_TAGS } from "./config.js?v=1";

let modal = null;
let onLoadCallback = null;
let allRows = [];
let activeFilter = "All";
let activeSearch = "";

export function init() {
    modal = document.getElementById("library-modal");
    if (!modal) return;
    modal.addEventListener("click", (e) => {
        if (e.target === modal || e.target.classList.contains("library-close")) close();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !modal.hasAttribute("hidden")) close();
    });
}

export async function open(onLoad) {
    if (!modal) return;
    onLoadCallback = onLoad;
    modal.removeAttribute("hidden");
    modal.style.display = "";
    await refresh();
}

export function close() {
    if (!modal) return;
    modal.setAttribute("hidden", "");
    modal.style.display = "none";
}

async function refresh() {
    const body = modal.querySelector(".library-body");
    body.innerHTML = `<div class="library-empty">Loading…</div>`;

    if (!isReady()) {
        body.innerHTML = `
            <div class="library-empty">
                Supabase isn't configured. Edit <code>js/config.js</code> with your project URL
                and anon key — see the <strong>Supabase setup</strong> section in the README.
            </div>`;
        return;
    }

    try {
        allRows = await listLogs();
    } catch (err) {
        body.innerHTML = `<div class="library-empty bad">Failed to list logs: ${escapeHtml(err.message || String(err))}</div>`;
        return;
    }
    render();
}

function render() {
    const body = modal.querySelector(".library-body");
    body.innerHTML = "";

    body.appendChild(renderToolbar());

    const filtered = allRows.filter((r) => {
        if (activeFilter !== "All" && r.event_tag !== activeFilter) return false;
        if (activeSearch) {
            const hay = `${r.file_name} ${r.event_tag}`.toLowerCase();
            if (!hay.includes(activeSearch.toLowerCase())) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "library-empty";
        empty.textContent = allRows.length === 0
            ? "No logs in the library yet. Drop a .wpilog into HawkDash to upload."
            : "No logs match the current filter.";
        body.appendChild(empty);
        return;
    }

    const groups = groupByEvent(filtered);
    for (const [tag, rows] of groups) {
        const g = document.createElement("div");
        g.className = "library-group";
        const h = document.createElement("div");
        h.className = "library-group-header";
        h.innerHTML = `<span class="library-group-tag">${escapeHtml(tag)}</span><span class="library-group-count">${rows.length}</span>`;
        g.appendChild(h);
        for (const row of rows) g.appendChild(renderRow(row));
        body.appendChild(g);
    }
}

function renderToolbar() {
    const bar = document.createElement("div");
    bar.className = "library-toolbar";

    const tags = ["All", ...uniqueTags()];
    const chips = document.createElement("div");
    chips.className = "library-chips";
    for (const t of tags) {
        const c = document.createElement("button");
        c.className = "library-chip" + (t === activeFilter ? " active" : "");
        c.textContent = t;
        c.addEventListener("click", () => { activeFilter = t; render(); });
        chips.appendChild(c);
    }
    bar.appendChild(chips);

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search by name or tag";
    search.className = "library-search";
    search.value = activeSearch;
    search.addEventListener("input", (e) => { activeSearch = e.target.value; render(); });
    bar.appendChild(search);

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "btn ghost";
    refreshBtn.textContent = "Refresh";
    refreshBtn.addEventListener("click", () => refresh());
    bar.appendChild(refreshBtn);

    return bar;
}

function renderRow(row) {
    const el = document.createElement("div");
    el.className = "library-row";

    const left = document.createElement("div");
    left.className = "library-row-main";

    const name = document.createElement("div");
    name.className = "library-row-name";
    name.textContent = row.file_name;
    left.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "library-row-meta";
    const parts = [
        formatBytes(row.size_bytes),
        row.duration_sec ? formatDuration(row.duration_sec) : null,
        row.uploaded_at ? formatDate(row.uploaded_at) : null,
    ].filter(Boolean);
    meta.textContent = parts.join(" · ");
    left.appendChild(meta);

    el.appendChild(left);

    const actions = document.createElement("div");
    actions.className = "library-row-actions";

    const loadBtn = document.createElement("button");
    loadBtn.className = "btn";
    loadBtn.textContent = "Load";
    loadBtn.addEventListener("click", () => loadRow(row, loadBtn));
    actions.appendChild(loadBtn);

    const dlBtn = document.createElement("button");
    dlBtn.className = "btn ghost";
    dlBtn.textContent = "Download";
    dlBtn.addEventListener("click", () => downloadRow(row));
    actions.appendChild(dlBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "btn ghost danger";
    delBtn.textContent = "Delete";
    delBtn.title = "Remove from library";
    delBtn.addEventListener("click", () => deleteRow(row));
    actions.appendChild(delBtn);

    el.appendChild(actions);
    return el;
}

async function loadRow(row, btn) {
    if (!onLoadCallback) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Loading…";
    try {
        const blob = await downloadLogBlob(row.storage_path);
        const file = new File([blob], row.file_name, { type: "application/octet-stream" });
        close();
        await onLoadCallback(file, { skipUpload: true, knownRow: row });
    } catch (err) {
        alert("Failed to load log: " + (err.message || err));
        btn.disabled = false;
        btn.textContent = original;
    }
}

function downloadRow(row) {
    const url = getPublicUrl(row.storage_path);
    if (!url) {
        alert("Could not build download URL.");
        return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = row.file_name;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

async function deleteRow(row) {
    if (!confirm(`Delete "${row.file_name}" from the library? This can't be undone.`)) return;
    try {
        await deleteLog(row);
        allRows = allRows.filter((r) => r.id !== row.id);
        render();
    } catch (err) {
        alert("Failed to delete: " + (err.message || err));
    }
}

function uniqueTags() {
    const set = new Set(PRESET_EVENT_TAGS);
    for (const r of allRows) if (r.event_tag) set.add(r.event_tag);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function groupByEvent(rows) {
    const map = new Map();
    for (const r of rows) {
        const tag = r.event_tag || "(untagged)";
        if (!map.has(tag)) map.set(tag, []);
        map.get(tag).push(r);
    }
    // Sort: Home first, then alphabetical, untagged last.
    return Array.from(map.entries()).sort(([a], [b]) => {
        if (a === b) return 0;
        if (a === "Home") return -1;
        if (b === "Home") return 1;
        if (a === "(untagged)") return 1;
        if (b === "(untagged)") return -1;
        return a.localeCompare(b);
    });
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
}

function formatBytes(n) {
    if (n == null) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
    return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatDuration(s) {
    if (!Number.isFinite(s) || s <= 0) return "—";
    const m = Math.floor(s / 60);
    const sec = s - m * 60;
    return `${m}m ${sec.toFixed(0)}s`;
}

function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
