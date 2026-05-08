import { parseWpilog } from "./wpilog.js?v=6";
import { LogStore } from "./store.js?v=6";
import { sha256Hex } from "./hash.js?v=1";
import {
    isReady as supabaseReady,
    findBySha256,
    uploadLog,
    updateEventTag,
} from "./supabase.js?v=1";
import * as library from "./library.js?v=1";
import { DEFAULT_EVENT_TAG, PRESET_EVENT_TAGS, isConfigured } from "./config.js?v=1";

import * as overview from "./views/overview.js?v=6";
import * as power from "./views/power.js?v=6";
import * as vision from "./views/vision.js?v=6";
import * as shooter from "./views/shooter.js?v=6";
import * as intake from "./views/intake.js?v=6";
import * as indexer from "./views/indexer.js?v=6";
import * as swerve from "./views/swerve.js?v=6";
import * as alerts from "./views/alerts.js?v=6";
import * as system from "./views/system.js?v=6";
import * as timing from "./views/timing.js?v=6";

const VIEWS = [overview, power, vision, shooter, intake, indexer, swerve, alerts, system, timing];

const dropzone = document.getElementById("dropzone");
const loading = document.getElementById("loading");
const loadingStatus = document.getElementById("loading-status");
const dashboard = document.getElementById("dashboard");
const headerMeta = document.getElementById("header-meta");
const fileInput = document.getElementById("file-input");
const openBtn = document.getElementById("open-btn");
const browseBtn = document.getElementById("browse-btn");
const closeBtn = document.getElementById("close-btn");
const libraryBtn = document.getElementById("library-btn");
const banner = document.getElementById("library-banner");
const nav = document.getElementById("nav");
const viewContainer = document.getElementById("view-container");
const entryCountFooter = document.getElementById("entry-count");

let currentStore = null;
let currentViewId = null;

// `hidden` attribute can lose to custom display rules; force it via inline style.
function show(el) { if (!el) return; el.style.display = ""; el.removeAttribute("hidden"); }
function hide(el) { if (!el) return; el.style.display = "none"; el.setAttribute("hidden", ""); }
hide(loading);
hide(dashboard);
hide(closeBtn);
hide(banner);

library.init();

openBtn.addEventListener("click", () => fileInput.click());
browseBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f);
});

closeBtn.addEventListener("click", reset);

if (libraryBtn) {
    if (!isConfigured()) {
        libraryBtn.title = "Supabase not configured — see README";
    }
    libraryBtn.addEventListener("click", () => library.open(loadFile));
}

["dragenter", "dragover"].forEach(ev =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); })
);
["dragleave", "drop"].forEach(ev =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); })
);
dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

async function loadFile(file, opts = {}) {
    const { skipUpload = false, knownRow = null } = opts;
    hide(dropzone);
    hide(dashboard);
    hide(banner);
    show(loading);
    loadingStatus.textContent = `Reading ${file.name}…`;
    try {
        const buffer = await file.arrayBuffer();
        loadingStatus.textContent = `Parsing ${file.name}…`;
        await new Promise(r => setTimeout(r, 16));
        const parsed = parseWpilog(buffer);
        parsed.fileName = file.name;
        currentStore = new LogStore(parsed);
        renderHeader(file, parsed);
        renderNav();
        showView(VIEWS[0].meta.id);
        hide(loading);
        show(dashboard);
        show(closeBtn);

        if (supabaseReady()) {
            // Compute hash and reconcile with the library in the background so
            // the dashboard renders immediately.
            syncLibrary(file, buffer, parsed, { skipUpload, knownRow }).catch((err) => {
                console.error("Library sync failed:", err);
                renderBanner({ kind: "error", message: err.message || String(err) });
            });
        } else {
            // Soft hint so contributors notice the feature exists.
            renderBanner({ kind: "info", message: "Supabase not configured — log was not saved to the library." });
        }
    } catch (err) {
        hide(loading);
        show(dropzone);
        alert("Failed to parse log: " + err.message);
        console.error(err);
    }
}

async function syncLibrary(file, buffer, parsed, { skipUpload, knownRow }) {
    if (knownRow) {
        renderBanner({ kind: "exists", row: knownRow });
        return;
    }

    renderBanner({ kind: "working", message: "Hashing…" });
    const hash = await sha256Hex(buffer);

    renderBanner({ kind: "working", message: "Checking library…" });
    let row = await findBySha256(hash);

    if (!row && !skipUpload) {
        renderBanner({ kind: "working", message: "Uploading to library…" });
        row = await uploadLog({
            file,
            hash,
            eventTag: DEFAULT_EVENT_TAG,
            durationSec: parsed.durationSec,
        });
        renderBanner({ kind: "saved", row });
    } else if (row) {
        renderBanner({ kind: "exists", row });
    }
}

function renderBanner(state) {
    if (!banner) return;
    banner.innerHTML = "";
    banner.className = "library-banner";
    if (!state) { hide(banner); return; }

    const left = document.createElement("div");
    left.className = "library-banner-left";

    if (state.kind === "working") {
        const spin = document.createElement("span");
        spin.className = "library-banner-spinner";
        left.appendChild(spin);
        const txt = document.createElement("span");
        txt.textContent = state.message;
        left.appendChild(txt);
    } else if (state.kind === "saved" || state.kind === "exists") {
        const icon = document.createElement("span");
        icon.className = "library-banner-icon ok";
        icon.textContent = "✓";
        left.appendChild(icon);
        const txt = document.createElement("span");
        txt.innerHTML = state.kind === "saved"
            ? `Saved to library as <strong>${escapeHtml(state.row.event_tag)}</strong>`
            : `Already in library as <strong>${escapeHtml(state.row.event_tag)}</strong>`;
        left.appendChild(txt);
    } else if (state.kind === "info") {
        const icon = document.createElement("span");
        icon.className = "library-banner-icon";
        icon.textContent = "ⓘ";
        left.appendChild(icon);
        const txt = document.createElement("span");
        txt.textContent = state.message;
        left.appendChild(txt);
    } else if (state.kind === "error") {
        banner.classList.add("bad");
        const icon = document.createElement("span");
        icon.className = "library-banner-icon bad";
        icon.textContent = "!";
        left.appendChild(icon);
        const txt = document.createElement("span");
        txt.textContent = `Library sync failed: ${state.message}`;
        left.appendChild(txt);
    }

    banner.appendChild(left);

    const right = document.createElement("div");
    right.className = "library-banner-right";

    if (state.kind === "saved" || state.kind === "exists") {
        right.appendChild(buildTagPicker(state.row));
    }
    banner.appendChild(right);
    show(banner);
}

function buildTagPicker(row) {
    const wrap = document.createElement("div");
    wrap.className = "tag-picker";

    const label = document.createElement("span");
    label.className = "tag-picker-label";
    label.textContent = "Event:";
    wrap.appendChild(label);

    const select = document.createElement("select");
    select.className = "tag-picker-select";

    const tags = new Set(PRESET_EVENT_TAGS);
    if (row.event_tag) tags.add(row.event_tag);
    const sorted = Array.from(tags).sort((a, b) => {
        if (a === "Home") return -1;
        if (b === "Home") return 1;
        return a.localeCompare(b);
    });
    for (const t of sorted) {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        if (t === row.event_tag) opt.selected = true;
        select.appendChild(opt);
    }
    const newOpt = document.createElement("option");
    newOpt.value = "__new__";
    newOpt.textContent = "New tag…";
    select.appendChild(newOpt);

    const status = document.createElement("span");
    status.className = "tag-picker-status";

    select.addEventListener("change", async () => {
        let next = select.value;
        if (next === "__new__") {
            const typed = prompt("New event tag (e.g., 2026 Bridgewater Off-Season):", "");
            if (!typed || !typed.trim()) {
                select.value = row.event_tag || DEFAULT_EVENT_TAG;
                return;
            }
            next = typed.trim();
        }
        if (next === row.event_tag) return;
        select.disabled = true;
        status.textContent = "Saving…";
        try {
            const updated = await updateEventTag(row.id, next);
            if (updated) {
                Object.assign(row, updated);
            } else {
                row.event_tag = next;
            }
            // Rebuild picker to reflect the new option if it was freeform.
            renderBanner({ kind: "saved", row });
        } catch (err) {
            status.textContent = "Failed";
            console.error(err);
            select.value = row.event_tag || DEFAULT_EVENT_TAG;
        } finally {
            select.disabled = false;
        }
    });

    wrap.appendChild(select);
    wrap.appendChild(status);
    return wrap;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
}

function renderHeader(file, parsed) {
    headerMeta.innerHTML = "";
    const items = [
        ["File", file.name],
        ["Size", formatBytes(file.size)],
        ["Duration", formatDuration(parsed.durationSec)],
        ["Entries", String(parsed.entries.size)],
        ["Records", parsed.totalRecords.toLocaleString()],
    ];
    for (const [label, value] of items) {
        const item = document.createElement("div");
        item.className = "meta-item";
        const l = document.createElement("span");
        l.className = "meta-label";
        l.textContent = label;
        const v = document.createElement("span");
        v.className = "meta-value";
        v.textContent = value;
        item.appendChild(l);
        item.appendChild(v);
        headerMeta.appendChild(item);
    }
    entryCountFooter.textContent = `${parsed.entries.size} entries · ${parsed.totalRecords.toLocaleString()} records`;
}

function renderNav() {
    nav.innerHTML = "";
    for (const v of VIEWS) {
        const btn = document.createElement("button");
        btn.className = "nav-item";
        btn.dataset.view = v.meta.id;
        const icon = document.createElement("span");
        icon.className = "nav-icon";
        icon.textContent = v.meta.icon;
        const label = document.createElement("span");
        label.textContent = v.meta.label;
        btn.appendChild(icon);
        btn.appendChild(label);
        const badge = navBadge(v, currentStore);
        if (badge) btn.appendChild(badge);
        btn.addEventListener("click", () => showView(v.meta.id));
        nav.appendChild(btn);
    }
}

function navBadge(view, store) {
    if (!store) return null;
    if (view.meta.id === "alerts") {
        const errArr = store.get("/Alerts/errors") || store.get("Alerts/errors");
        const warnArr = store.get("/Alerts/warnings") || store.get("Alerts/warnings");
        let errCount = 0, warnCount = 0;
        if (errArr) for (let i = 0; i < errArr.count; i++) errCount += (errArr.values[i] || []).length;
        if (warnArr) for (let i = 0; i < warnArr.count; i++) warnCount += (warnArr.values[i] || []).length;
        if (errCount + warnCount === 0) return null;
        const b = document.createElement("span");
        b.className = "nav-badge " + (errCount ? "bad" : "warn");
        b.textContent = String(errCount + warnCount);
        return b;
    }
    return null;
}

function showView(id) {
    currentViewId = id;
    for (const item of nav.querySelectorAll(".nav-item")) {
        item.classList.toggle("active", item.dataset.view === id);
    }
    viewContainer.innerHTML = "";
    const view = VIEWS.find(v => v.meta.id === id);
    if (!view) return;
    try {
        view.render(viewContainer, currentStore);
    } catch (err) {
        console.error(err);
        viewContainer.innerHTML = `<div class="empty-note">Error rendering view: ${err.message}</div>`;
    }
}

function reset() {
    currentStore = null;
    currentViewId = null;
    headerMeta.innerHTML = '<span class="empty">No log loaded</span>';
    entryCountFooter.textContent = "";
    viewContainer.innerHTML = "";
    nav.innerHTML = "";
    hide(closeBtn);
    hide(dashboard);
    hide(banner);
    show(dropzone);
    fileInput.value = "";
}

function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
    return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatDuration(s) {
    if (!Number.isFinite(s) || s <= 0) return "—";
    const m = Math.floor(s / 60);
    const sec = s - m * 60;
    return `${m}m ${sec.toFixed(1)}s`;
}
