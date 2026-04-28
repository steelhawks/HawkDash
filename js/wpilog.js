// WPILOG (WPILib datalog v1.0) parser.
//
// File layout:
//   bytes 0..5  : "WPILOG" magic
//   bytes 6..7  : version (LE u16, 0x0100 = 1.0)
//   bytes 8..11 : extra header length (LE u32)
//   bytes 12..  : extra header (UTF-8)
//   then a stream of records.
//
// Each record:
//   byte 0      : header bitfield
//                   bits 0-1: entry id length - 1   (1..4 bytes)
//                   bits 2-3: payload length length - 1 (1..4 bytes)
//                   bits 4-6: timestamp length - 1  (1..8 bytes)
//   entry id    : LE unsigned, variable width
//   payload len : LE unsigned, variable width
//   timestamp   : LE unsigned (microseconds), variable width
//   payload     : `payload len` bytes
//
// Entry id 0 -> control record. payload[0] selects:
//   0 = Start  : (u32 entry id)(u32 nameLen)(name)(u32 typeLen)(type)(u32 metaLen)(meta)
//   1 = Finish : (u32 entry id)
//   2 = Set Metadata : (u32 entry id)(u32 metaLen)(meta)

const TEXT = new TextDecoder("utf-8");

// Known struct schemas. Maps type name -> decoder(view, offset) -> object, plus byte size.
// AdvantageKit uses WPILib's struct serialization for these.
const STRUCT_DECODERS = {
    "Pose2d": {
        size: 24,
        decode: (dv, o) => ({
            x: dv.getFloat64(o, true),
            y: dv.getFloat64(o + 8, true),
            rot: dv.getFloat64(o + 16, true),
        }),
    },
    "Translation2d": {
        size: 16,
        decode: (dv, o) => ({
            x: dv.getFloat64(o, true),
            y: dv.getFloat64(o + 8, true),
        }),
    },
    "Rotation2d": {
        size: 8,
        decode: (dv, o) => ({ rot: dv.getFloat64(o, true) }),
    },
    "ChassisSpeeds": {
        size: 24,
        decode: (dv, o) => ({
            vx: dv.getFloat64(o, true),
            vy: dv.getFloat64(o + 8, true),
            omega: dv.getFloat64(o + 16, true),
        }),
    },
    "SwerveModuleState": {
        size: 16,
        decode: (dv, o) => ({
            speed: dv.getFloat64(o, true),
            angle: dv.getFloat64(o + 8, true),
        }),
    },
    "SwerveModulePosition": {
        size: 16,
        decode: (dv, o) => ({
            distance: dv.getFloat64(o, true),
            angle: dv.getFloat64(o + 8, true),
        }),
    },
    "Translation3d": {
        size: 24,
        decode: (dv, o) => ({
            x: dv.getFloat64(o, true),
            y: dv.getFloat64(o + 8, true),
            z: dv.getFloat64(o + 16, true),
        }),
    },
    "Rotation3d": {
        size: 32,
        decode: (dv, o) => ({
            qw: dv.getFloat64(o, true),
            qx: dv.getFloat64(o + 8, true),
            qy: dv.getFloat64(o + 16, true),
            qz: dv.getFloat64(o + 24, true),
        }),
    },
    "Pose3d": {
        size: 56,
        decode: (dv, o) => ({
            x: dv.getFloat64(o, true),
            y: dv.getFloat64(o + 8, true),
            z: dv.getFloat64(o + 16, true),
            qw: dv.getFloat64(o + 24, true),
            qx: dv.getFloat64(o + 32, true),
            qy: dv.getFloat64(o + 40, true),
            qz: dv.getFloat64(o + 48, true),
        }),
    },
};

function decodeStruct(typeName, bytes) {
    const decoder = STRUCT_DECODERS[typeName];
    if (!decoder) return null;
    if (bytes.byteLength < decoder.size) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return decoder.decode(dv, 0);
}

function decodeStructArray(typeName, bytes) {
    const decoder = STRUCT_DECODERS[typeName];
    if (!decoder) return null;
    const count = Math.floor(bytes.byteLength / decoder.size);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
        out[i] = decoder.decode(dv, i * decoder.size);
    }
    return out;
}

// Parse the type string. Returns { kind, base, isArray }.
//   "boolean"            -> { kind: "boolean" }
//   "double[]"           -> { kind: "double", isArray: true }
//   "struct:Pose2d"      -> { kind: "struct", base: "Pose2d" }
//   "struct:Pose2d[]"    -> { kind: "struct", base: "Pose2d", isArray: true }
function parseType(t) {
    let isArray = false;
    if (t.endsWith("[]")) {
        isArray = true;
        t = t.slice(0, -2);
    }
    if (t.startsWith("struct:")) {
        return { kind: "struct", base: t.slice(7), isArray };
    }
    if (t.startsWith("proto:")) {
        return { kind: "proto", base: t.slice(6), isArray };
    }
    return { kind: t, isArray };
}

function decodePayload(typeInfo, bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const { kind, isArray } = typeInfo;
    if (isArray) {
        switch (kind) {
            case "boolean": {
                const out = new Uint8Array(bytes.byteLength);
                for (let i = 0; i < bytes.byteLength; i++) out[i] = bytes[i] ? 1 : 0;
                return out;
            }
            case "int64": {
                const n = Math.floor(bytes.byteLength / 8);
                const out = new Float64Array(n);
                for (let i = 0; i < n; i++) {
                    // BigInt -> Number; precision may drop above 2^53, accept for charts.
                    out[i] = Number(dv.getBigInt64(i * 8, true));
                }
                return out;
            }
            case "float": {
                const n = Math.floor(bytes.byteLength / 4);
                const out = new Float32Array(n);
                for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true);
                return out;
            }
            case "double": {
                const n = Math.floor(bytes.byteLength / 8);
                const out = new Float64Array(n);
                for (let i = 0; i < n; i++) out[i] = dv.getFloat64(i * 8, true);
                return out;
            }
            case "string": {
                let off = 0;
                if (bytes.byteLength < 4) return [];
                const count = dv.getUint32(off, true); off += 4;
                const out = new Array(count);
                for (let i = 0; i < count; i++) {
                    const slen = dv.getUint32(off, true); off += 4;
                    out[i] = TEXT.decode(bytes.subarray(off, off + slen));
                    off += slen;
                }
                return out;
            }
            case "struct":
                return decodeStructArray(typeInfo.base, bytes) || bytes;
            default:
                return bytes;
        }
    }
    switch (kind) {
        case "boolean": return bytes[0] !== 0;
        case "int64": return Number(dv.getBigInt64(0, true));
        case "float": return dv.getFloat32(0, true);
        case "double": return dv.getFloat64(0, true);
        case "string":
        case "json":
            return TEXT.decode(bytes);
        case "struct":
            return decodeStruct(typeInfo.base, bytes) || bytes;
        default:
            return bytes;
    }
}

// Numeric type test for fast columnar storage.
function isScalarNumeric(typeInfo) {
    if (typeInfo.isArray) return false;
    return typeInfo.kind === "double" || typeInfo.kind === "float" || typeInfo.kind === "int64";
}

function isScalarBoolean(typeInfo) {
    return !typeInfo.isArray && typeInfo.kind === "boolean";
}

// Resizable typed-array buffer.
class FloatBuf {
    constructor() {
        this.cap = 256;
        this.len = 0;
        this.buf = new Float64Array(this.cap);
    }
    push(v) {
        if (this.len === this.cap) {
            this.cap *= 2;
            const nb = new Float64Array(this.cap);
            nb.set(this.buf);
            this.buf = nb;
        }
        this.buf[this.len++] = v;
    }
    finalize() {
        return this.buf.subarray(0, this.len);
    }
}

class Uint8Buf {
    constructor() {
        this.cap = 256;
        this.len = 0;
        this.buf = new Uint8Array(this.cap);
    }
    push(v) {
        if (this.len === this.cap) {
            this.cap *= 2;
            const nb = new Uint8Array(this.cap);
            nb.set(this.buf);
            this.buf = nb;
        }
        this.buf[this.len++] = v ? 1 : 0;
    }
    finalize() {
        return this.buf.subarray(0, this.len);
    }
}

// Public entry point.
//
// Returns:
//   {
//     version: number,          // packed version, e.g. 0x0100
//     extraHeader: string,
//     entries: Map<name, EntryRecord>,
//     startTimeUs: number,      // earliest record timestamp
//     endTimeUs: number,        // latest record timestamp
//     totalRecords: number,
//   }
//
// EntryRecord:
//   { id, name, type, typeInfo, metadata, timestamps: Float64Array (seconds, relative to log start),
//     values: Float64Array | Uint8Array | Array, kind: 'numeric'|'boolean'|'object', count }
export function parseWpilog(buffer, onProgress) {
    const u8 = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    if (u8.byteLength < 12) throw new Error("File too small to be a wpilog");
    if (
        u8[0] !== 0x57 || u8[1] !== 0x50 || u8[2] !== 0x49 || // WPI
        u8[3] !== 0x4c || u8[4] !== 0x4f || u8[5] !== 0x47    // LOG
    ) {
        throw new Error("Not a WPILOG file (missing magic header)");
    }
    const version = dv.getUint16(6, true);
    const extraLen = dv.getUint32(8, true);
    const extraHeader = TEXT.decode(u8.subarray(12, 12 + extraLen));
    let off = 12 + extraLen;

    // Active entries by id (during stream).
    const activeById = new Map();
    // Final entries by name.
    const entries = new Map();

    let startTimeUs = Infinity;
    let endTimeUs = -Infinity;
    let totalRecords = 0;
    const total = u8.byteLength;

    const getEntry = (id) => activeById.get(id);

    const ensureRecord = (e) => {
        let rec = entries.get(e.name);
        if (rec) return rec;
        const ti = parseType(e.type);
        let kind;
        let values;
        if (isScalarNumeric(ti)) {
            kind = "numeric";
            values = new FloatBuf();
        } else if (isScalarBoolean(ti)) {
            kind = "boolean";
            values = new Uint8Buf();
        } else {
            kind = "object";
            values = [];
        }
        rec = {
            id: e.id,
            name: e.name,
            type: e.type,
            typeInfo: ti,
            metadata: e.metadata,
            timestamps: new FloatBuf(),
            values,
            kind,
        };
        entries.set(e.name, rec);
        return rec;
    };

    while (off < u8.byteLength) {
        const headerByte = u8[off]; off += 1;
        const idLen = (headerByte & 0x03) + 1;
        const sizeLen = ((headerByte >> 2) & 0x03) + 1;
        const tsLen = ((headerByte >> 4) & 0x07) + 1;
        if (off + idLen + sizeLen + tsLen > u8.byteLength) break;

        let id = 0;
        for (let i = 0; i < idLen; i++) id |= u8[off + i] << (i * 8);
        id = id >>> 0;
        off += idLen;

        let size = 0;
        for (let i = 0; i < sizeLen; i++) size |= u8[off + i] << (i * 8);
        size = size >>> 0;
        off += sizeLen;

        let ts = 0;
        // Use Number; safe up to 2^53 microseconds (~285 years).
        for (let i = 0; i < tsLen; i++) ts += u8[off + i] * Math.pow(2, i * 8);
        off += tsLen;

        if (off + size > u8.byteLength) break;

        if (id === 0) {
            // Control record.
            const p = u8.subarray(off, off + size);
            const controlType = p[0];
            if (controlType === 0 && size >= 17) {
                let po = 1;
                const cdv = new DataView(p.buffer, p.byteOffset, p.byteLength);
                const entryId = cdv.getUint32(po, true); po += 4;
                const nameLen = cdv.getUint32(po, true); po += 4;
                const name = TEXT.decode(p.subarray(po, po + nameLen)); po += nameLen;
                const typeLen = cdv.getUint32(po, true); po += 4;
                const type = TEXT.decode(p.subarray(po, po + typeLen)); po += typeLen;
                const metaLen = cdv.getUint32(po, true); po += 4;
                const metadata = TEXT.decode(p.subarray(po, po + metaLen));
                activeById.set(entryId, { id: entryId, name, type, metadata });
            } else if (controlType === 1 && size >= 5) {
                const cdv = new DataView(p.buffer, p.byteOffset, p.byteLength);
                const entryId = cdv.getUint32(1, true);
                activeById.delete(entryId);
            } else if (controlType === 2 && size >= 9) {
                const cdv = new DataView(p.buffer, p.byteOffset, p.byteLength);
                const entryId = cdv.getUint32(1, true);
                const metaLen = cdv.getUint32(5, true);
                const metadata = TEXT.decode(p.subarray(9, 9 + metaLen));
                const e = activeById.get(entryId);
                if (e) e.metadata = metadata;
            }
        } else {
            const e = getEntry(id);
            if (e) {
                if (ts < startTimeUs) startTimeUs = ts;
                if (ts > endTimeUs) endTimeUs = ts;
                const rec = ensureRecord(e);
                const payload = u8.subarray(off, off + size);
                if (rec.kind === "numeric") {
                    let v;
                    switch (rec.typeInfo.kind) {
                        case "double": v = new DataView(payload.buffer, payload.byteOffset, 8).getFloat64(0, true); break;
                        case "float": v = new DataView(payload.buffer, payload.byteOffset, 4).getFloat32(0, true); break;
                        case "int64": v = Number(new DataView(payload.buffer, payload.byteOffset, 8).getBigInt64(0, true)); break;
                        default: v = NaN;
                    }
                    rec.values.push(v);
                    rec.timestamps.push(ts);
                } else if (rec.kind === "boolean") {
                    rec.values.push(payload[0] !== 0 ? 1 : 0);
                    rec.timestamps.push(ts);
                } else {
                    rec.values.push(decodePayload(rec.typeInfo, payload));
                    rec.timestamps.push(ts);
                }
            }
            totalRecords++;
        }
        off += size;

        if (onProgress && (totalRecords & 0xffff) === 0) {
            onProgress(off / total);
        }
    }

    // Finalize and convert timestamps from us to seconds (relative to log start).
    const startSec = startTimeUs === Infinity ? 0 : startTimeUs / 1e6;
    for (const rec of entries.values()) {
        const tsArr = rec.timestamps.finalize();
        // Convert in place to seconds-relative.
        for (let i = 0; i < tsArr.length; i++) tsArr[i] = tsArr[i] / 1e6 - startSec;
        rec.timestamps = tsArr;
        rec.values = rec.values instanceof Array ? rec.values : rec.values.finalize();
        rec.count = rec.timestamps.length;
    }

    return {
        version,
        extraHeader,
        entries,
        startTimeUs: startTimeUs === Infinity ? 0 : startTimeUs,
        endTimeUs: endTimeUs === -Infinity ? 0 : endTimeUs,
        durationSec: (endTimeUs - startTimeUs) / 1e6,
        totalRecords,
    };
}
