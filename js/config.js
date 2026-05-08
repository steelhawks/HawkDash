// Supabase config. Paste your project's URL and anon (public) key here.
// Setup steps live in README.md under "Supabase setup".
export const SUPABASE_URL = "";
export const SUPABASE_ANON_KEY = "";

export const STORAGE_BUCKET = "wpilogs";
export const LOGS_TABLE = "logs";

// Default tag for unlabelled uploads — at-home practice/scrim sessions.
export const DEFAULT_EVENT_TAG = "Home";

// Preset tags shown in the dropdown. Existing tags from the DB are merged in
// at runtime, so this list only needs to seed the season's expected events.
export const PRESET_EVENT_TAGS = [
    "Home",
    "Bridgewater-Raritan",
    "Hatboro-Horsham",
    "Mount Olive",
    "Seneca",
    "Robbinsville",
    "FMA District Champs",
    "FIRST Championship",
];

export function isConfigured() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
