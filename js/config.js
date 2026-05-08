// Supabase config. Paste your project's URL and anon (public) key here.
// Setup steps live in README.md under "Supabase setup".
export const SUPABASE_URL = "https://ykkbnbafhjwqwvdjwqba.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlra2JuYmFmaGp3cXd2ZGp3cWJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMzODk4MjgsImV4cCI6MjA3ODk2NTgyOH0.qofLeAWTfqYNu33Cm7kTwToafSpgvjjjQoows-n7TLA";

export const STORAGE_BUCKET = "wpilogs";
export const LOGS_TABLE = "logs";

// Default tag for unlabelled uploads — at-home practice/scrim sessions.
export const DEFAULT_EVENT_TAG = "Home";

// Preset tags shown in the dropdown. Existing tags from the DB are merged in
// at runtime, so this list only needs to seed the season's expected events.
export const PRESET_EVENT_TAGS = [
    "Home",
    "Hudson Valley Regional",
    "New York City Regional",
    "FIRST Championship",
];

export function isConfigured() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
