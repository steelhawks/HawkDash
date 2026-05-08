import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    STORAGE_BUCKET,
    LOGS_TABLE,
    isConfigured,
} from "./config.js?v=1";

let _client = null;

export function getClient() {
    if (!isConfigured()) return null;
    if (!_client) _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return _client;
}

export function isReady() {
    return getClient() !== null;
}

export async function findBySha256(hash) {
    const c = getClient();
    if (!c) return null;
    const { data, error } = await c
        .from(LOGS_TABLE)
        .select("*")
        .eq("sha256", hash)
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function listLogs() {
    const c = getClient();
    if (!c) return [];
    const { data, error } = await c
        .from(LOGS_TABLE)
        .select("*")
        .order("uploaded_at", { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function uploadLog({ file, hash, eventTag, durationSec }) {
    const c = getClient();
    if (!c) throw new Error("Supabase not configured");
    const path = `${hash}.wpilog`;

    // Storage upload. If the object already exists (a previous attempt landed
    // but the DB row didn't), we accept the duplicate and keep going.
    const { error: storageError } = await c.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: "application/octet-stream",
        });
    if (storageError && !/duplicate|exists|already/i.test(storageError.message || "")) {
        throw storageError;
    }

    const { data, error: dbError } = await c
        .from(LOGS_TABLE)
        .insert({
            sha256: hash,
            file_name: file.name,
            size_bytes: file.size,
            event_tag: eventTag,
            duration_sec: durationSec ?? null,
            storage_path: path,
        })
        .select()
        .single();
    if (dbError) {
        // Race: another tab inserted the same hash between our find and insert.
        if (/duplicate|unique|23505/i.test(dbError.message || dbError.code || "")) {
            return await findBySha256(hash);
        }
        throw dbError;
    }
    return data;
}

export async function updateEventTag(id, tag) {
    const c = getClient();
    if (!c) return null;
    const { data, error } = await c
        .from(LOGS_TABLE)
        .update({ event_tag: tag })
        .eq("id", id)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function deleteLog(row) {
    const c = getClient();
    if (!c) return;
    if (row.storage_path) {
        await c.storage.from(STORAGE_BUCKET).remove([row.storage_path]);
    }
    const { error } = await c.from(LOGS_TABLE).delete().eq("id", row.id);
    if (error) throw error;
}

export async function downloadLogBlob(storagePath) {
    // The bucket is public, so a plain fetch on the public URL avoids the
    // authed storage endpoint (which can trip CORS preflight in some browsers).
    const url = getPublicUrl(storagePath);
    if (!url) throw new Error("Supabase not configured");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    return await res.blob();
}

export function getPublicUrl(storagePath) {
    const c = getClient();
    if (!c) return null;
    const { data } = c.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    return data?.publicUrl || null;
}
