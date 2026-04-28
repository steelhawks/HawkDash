// LogStore wraps a parsed wpilog and exposes lookups the views need.
//
// AdvantageKit prepends `/RealOutputs/` to recordOutput keys when running
// the real robot, and `/ReplayOutputs/` when replayed. SystemStats / DriverStation
// / PowerDistribution / Timing / Alerts / NetworkTables keys are unprefixed.
// We fall back across the prefix variants so the dashboard works for both
// real and replay logs.

const PREFIX_VARIANTS = ["/RealOutputs/", "/ReplayOutputs/", "RealOutputs/", "ReplayOutputs/", ""];

export class LogStore {
    constructor(parsed) {
        this.parsed = parsed;
        this.entries = parsed.entries;
        this.durationSec = parsed.durationSec || 0;
        this._byName = new Map();
        // Case-insensitive index. Maps lowercase(name) -> entry. If multiple entries
        // collide on case, the first one wins (deterministic given Map iteration).
        this._byNameCI = new Map();
        for (const [name, rec] of this.entries) {
            this._byName.set(name, rec);
            const lc = name.toLowerCase();
            if (!this._byNameCI.has(lc)) this._byNameCI.set(lc, rec);
        }
        this._allNames = Array.from(this.entries.keys());
    }

    // Look up an entry, trying:
    //   1. exact match
    //   2. exact match with leading slash stripped
    //   3. each common prefix variant (RealOutputs / ReplayOutputs / "")
    //   4. case-insensitive variants of all of the above
    get(query) {
        if (this._byName.has(query)) return this._byName.get(query);
        if (query.startsWith("/")) {
            const noSlash = query.slice(1);
            if (this._byName.has(noSlash)) return this._byName.get(noSlash);
        }
        for (const p of PREFIX_VARIANTS) {
            const candidate = p + (query.startsWith("/") ? query.slice(1) : query);
            if (this._byName.has(candidate)) return this._byName.get(candidate);
        }
        // Case-insensitive fallback.
        const lc = query.toLowerCase();
        if (this._byNameCI.has(lc)) return this._byNameCI.get(lc);
        if (lc.startsWith("/") && this._byNameCI.has(lc.slice(1))) return this._byNameCI.get(lc.slice(1));
        for (const p of PREFIX_VARIANTS) {
            const candidate = (p + (query.startsWith("/") ? query.slice(1) : query)).toLowerCase();
            if (this._byNameCI.has(candidate)) return this._byNameCI.get(candidate);
        }
        return null;
    }

    // Find all entries whose name starts with `prefix` (case-insensitive).
    findByPrefix(prefix) {
        const lc = prefix.toLowerCase();
        const out = [];
        for (const name of this._allNames) {
            if (name.toLowerCase().startsWith(lc)) out.push(this.entries.get(name));
        }
        return out;
    }

    // Find all entries matching a substring (case-sensitive, on full name).
    find(substr) {
        const out = [];
        for (const name of this._allNames) {
            if (name.includes(substr)) out.push(this.entries.get(name));
        }
        return out;
    }

    // Entries whose name matches a regex.
    findRegex(re) {
        const out = [];
        for (const name of this._allNames) {
            if (re.test(name)) out.push(this.entries.get(name));
        }
        return out;
    }

    // Last value of an entry (or null if none).
    lastOf(query) {
        const e = this.get(query);
        if (!e || e.count === 0) return null;
        return e.values[e.count - 1];
    }

    // Mean of a numeric entry.
    meanOf(query) {
        const e = this.get(query);
        if (!e || e.kind !== "numeric" || e.count === 0) return null;
        let sum = 0, n = 0;
        for (let i = 0; i < e.count; i++) {
            const v = e.values[i];
            if (Number.isFinite(v)) { sum += v; n++; }
        }
        return n ? sum / n : null;
    }

    // Max of a numeric entry.
    maxOf(query) {
        const e = this.get(query);
        if (!e || e.kind !== "numeric" || e.count === 0) return null;
        let m = -Infinity;
        for (let i = 0; i < e.count; i++) {
            const v = e.values[i];
            if (Number.isFinite(v) && v > m) m = v;
        }
        return Number.isFinite(m) ? m : null;
    }

    // Min of a numeric entry.
    minOf(query) {
        const e = this.get(query);
        if (!e || e.kind !== "numeric" || e.count === 0) return null;
        let m = Infinity;
        for (let i = 0; i < e.count; i++) {
            const v = e.values[i];
            if (Number.isFinite(v) && v < m) m = v;
        }
        return Number.isFinite(m) ? m : null;
    }

    // Fraction of time a boolean entry is true (samples-weighted by duration between samples).
    trueFractionOf(query) {
        const e = this.get(query);
        if (!e || e.kind !== "boolean" || e.count === 0) return null;
        const total = this.durationSec;
        if (!total) return null;
        let acc = 0;
        for (let i = 0; i < e.count; i++) {
            const t0 = e.timestamps[i];
            const t1 = i + 1 < e.count ? e.timestamps[i + 1] : total;
            if (e.values[i]) acc += t1 - t0;
        }
        return acc / total;
    }

    // Number of rising edges (false->true) in a boolean entry.
    risingEdgesOf(query) {
        const e = this.get(query);
        if (!e || e.kind !== "boolean") return 0;
        let count = 0, prev = 0;
        for (let i = 0; i < e.count; i++) {
            const v = e.values[i];
            if (!prev && v) count++;
            prev = v;
        }
        return count;
    }
}
