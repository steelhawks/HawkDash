import { parseWpilog } from "./wpilog.js";
import { LogStore } from "./store.js";

import * as overview from "./views/overview.js";
import * as power from "./views/power.js";
import * as vision from "./views/vision.js";
import * as shooter from "./views/shooter.js";
import * as intake from "./views/intake.js";
import * as indexer from "./views/indexer.js";
import * as swerve from "./views/swerve.js";
import * as alerts from "./views/alerts.js";
import * as system from "./views/system.js";
import * as timing from "./views/timing.js";

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
const nav = document.getElementById("nav");
const viewContainer = document.getElementById("view-container");
const entryCountFooter = document.getElementById("entry-count");

let currentStore = null;
let currentViewId = null;

// `hidden` attribute can lose to custom display rules; force it via inline style.
function show(el) { el.style.display = ""; el.removeAttribute("hidden"); }
function hide(el) { el.style.display = "none"; el.setAttribute("hidden", ""); }
hide(loading);
hide(dashboard);
hide(closeBtn);

openBtn.addEventListener("click", () => fileInput.click());
browseBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f);
});

closeBtn.addEventListener("click", reset);

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

async function loadFile(file) {
    hide(dropzone);
    hide(dashboard);
    show(loading);
    loadingStatus.textContent = `Reading ${file.name}…`;
    try {
        const buffer = await file.arrayBuffer();
        loadingStatus.textContent = `Parsing ${file.name}…`;
        // Yield to the event loop so the UI shows the status.
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
    } catch (err) {
        hide(loading);
        show(dropzone);
        alert("Failed to parse log: " + err.message);
        console.error(err);
    }
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
