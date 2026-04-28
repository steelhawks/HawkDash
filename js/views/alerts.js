import { el, fmtInt, statCard, panel, viewHeader, fmt } from "../ui.js?v=7";

// AdvantageKit's Alert system publishes one group per Alert.AlertsContainer with
// three string[] entries: errors / warnings / infos. Robots usually have several
// groups: Alerts, PhotonAlerts, Choreo Alerts, etc. Each is published under
// /RealOutputs/<group>/{errors,warnings,infos}. We discover them dynamically.

function discoverAlertGroups(store) {
    const re = /^\/?(?:RealOutputs|ReplayOutputs)?\/?(.+?)\/(errors|warnings|infos)$/;
    const groups = new Map();
    for (const e of store.entries.values()) {
        if (e.kind !== "object") continue;
        const m = re.exec(e.name);
        if (!m) continue;
        const group = m[1];
        const level = m[2];
        // Heuristic: only treat it as an alert group if there's also a `.type` sibling
        // saying "Alerts", or if the entry type is string[].
        if (!e.type.startsWith("string[]")) continue;
        if (!groups.has(group)) groups.set(group, {});
        groups.get(group)[level === "errors" ? "error" : level === "warnings" ? "warning" : "info"] = e;
    }
    // Filter to groups that have at least one of the three sub-entries.
    const out = [];
    for (const [name, levels] of groups) {
        if (levels.error || levels.warning || levels.info) out.push({ name, ...levels });
    }
    return out;
}

function eventsFromEntry(entry, level) {
    if (!entry || entry.kind !== "object" || entry.count === 0) return [];
    const events = [];
    let prev = new Set();
    for (let i = 0; i < entry.count; i++) {
        const v = entry.values[i];
        const cur = new Set(Array.isArray(v) ? v : []);
        for (const m of cur) {
            if (!prev.has(m)) events.push({ ts: entry.timestamps[i], level, message: m, kind: "raised" });
        }
        for (const m of prev) {
            if (!cur.has(m)) events.push({ ts: entry.timestamps[i], level, message: m, kind: "cleared" });
        }
        prev = cur;
    }
    return events;
}

export function render(container, store) {
    const root = el("div");
    root.appendChild(viewHeader("Alerts", "AdvantageKit Alert system events across all groups"));

    const groups = discoverAlertGroups(store);
    const groupEvents = groups.map(g => ({
        name: g.name,
        events: [
            ...eventsFromEntry(g.error, "error"),
            ...eventsFromEntry(g.warning, "warning"),
            ...eventsFromEntry(g.info, "info"),
        ].sort((a, b) => a.ts - b.ts),
    }));

    const all = [];
    for (const g of groupEvents) for (const e of g.events) all.push({ group: g.name, ...e });
    all.sort((a, b) => a.ts - b.ts);

    const errorRaised = all.filter(e => e.level === "error" && e.kind === "raised").length;
    const warnRaised = all.filter(e => e.level === "warning" && e.kind === "raised").length;
    const infoRaised = all.filter(e => e.level === "info" && e.kind === "raised").length;

    const stats = el("div", { class: "stat-grid" });
    stats.appendChild(statCard("Alert groups", String(groups.length), { sub: groups.map(g => g.name).join(", ") || "—" }));
    stats.appendChild(statCard("Total events", fmtInt(all.length)));
    stats.appendChild(statCard("Errors raised", fmtInt(errorRaised), { cls: "bad" }));
    stats.appendChild(statCard("Warnings raised", fmtInt(warnRaised), { cls: "warn" }));
    stats.appendChild(statCard("Infos raised", fmtInt(infoRaised)));
    root.appendChild(stats);

    if (!groups.length) {
        root.appendChild(el("div", { class: "empty-note" }, "No alert groups detected in this log."));
        container.appendChild(root);
        return;
    }

    if (!all.length) {
        root.appendChild(el("div", { class: "empty-note" },
            `${groups.length} alert group(s) detected but none raised any alerts. 🎉`));
        container.appendChild(root);
        return;
    }

    // Most-frequent.
    const counts = new Map();
    for (const e of all) {
        if (e.kind !== "raised") continue;
        const k = `${e.level}|${e.group}|${e.message}`;
        counts.set(k, (counts.get(k) || 0) + 1);
    }
    const top = Array.from(counts.entries())
        .map(([k, n]) => { const [level, group, message] = k.split("|"); return { level, group, message, n }; })
        .sort((a, b) => b.n - a.n);

    const sumP = panel("Most frequent alerts", `${top.length} unique`);
    const list = el("div", { class: "alerts-list" });
    for (const r of top.slice(0, 30)) {
        list.appendChild(el("div", { class: `alert-row ${r.level}` },
            el("div", { class: "ts" }, "×" + r.n),
            el("div", { class: `lvl ${r.level}` }, r.level),
            el("div", {}, `[${r.group}] ${r.message}`),
        ));
    }
    sumP.appendChild(list);
    root.appendChild(sumP);

    // Full event log.
    const evP = panel("Event log", `${all.length} events`);
    const evList = el("div", { class: "alerts-list" });
    for (const e of all.slice(0, 500)) {
        evList.appendChild(el("div", { class: `alert-row ${e.level}` },
            el("div", { class: "ts" }, fmt(e.ts, 1, "s")),
            el("div", { class: `lvl ${e.level}` }, e.level),
            el("div", {}, `${e.kind === "raised" ? "▲" : "▽"} [${e.group}] ${e.message}`),
        ));
    }
    evP.appendChild(evList);
    if (all.length > 500) evP.appendChild(el("div", { class: "panel-sub" }, `(showing first 500 of ${all.length})`));
    root.appendChild(evP);

    container.appendChild(root);
}

export const meta = { id: "alerts", label: "Alerts", icon: "⚠" };
