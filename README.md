# HawkDash

A web dashboard for analyzing AdvantageKit `.wpilog` files from FRC team SteelHawks' `Rebuilt2026` robot.

Drop a `.wpilog` into the page and HawkDash parses it locally in your browser. If a Supabase project is configured (see [Supabase setup](#supabase-setup) below), the log is also saved to a shared library so the team can browse, filter by event (Home / each comp), and re-download from any device. The dashboard renders charts and tables for:

- **Overview** — match metadata, alliance, enabled time, robot mode timeline
- **Power** — battery voltage / current / power, PDH per-channel currents, per-device current draw, energy usage
- **Vision** — camera connection status, accepted / rejected pose counts, tag tracking
- **Shooter** — flywheel velocity vs. target, hood angle, turret angle, "ready to shoot" / "at goal" timeline, SOTM ballistics
- **Intake / Indexer** — rack positions, currents, beam break, stall / jam flags
- **Swerve** — module velocities, drive currents, gyro acceleration, chassis speeds, collision detection
- **Alerts** — error, warning, and info timelines from the AdvantageKit `Alert` system
- **System** — CPU temp, RAM usage, CAN utilization, loop overrun count
- **Timing** — per-subsystem loop times from `LoopTimeUtil`

## Running locally

It's a pure static site — no build step.

```sh
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

Or open `index.html` directly in a browser (some browsers restrict ES module loading from `file://`, in which case use the local server).

## Deploying

Any static host works. For GitHub Pages, push `main` and enable Pages on the repo root.

## Supabase setup

The library feature (auto-saving uploaded logs and browsing them later) is optional. Without it, HawkDash still works — logs are parsed locally, just not stored. To enable it:

### 1. Create a Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project. Free tier is fine.
2. From the project dashboard, copy the **Project URL** and the **anon public** API key (Settings → API).

### 2. Paste them into `js/config.js`

```js
export const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

### 3. Create the storage bucket

In the Supabase dashboard → **Storage** → **New bucket**:

- Name: `wpilogs`
- Public: **yes** (so the dashboard can stream/download files without signed URLs)
- File size limit: bump to **at least 100 MB** (default is 50 MB; long match logs can exceed it)

Then add storage policies (Storage → Policies → `wpilogs` → New policy → "For full customization"). The dashboard's "public" access model needs:

```sql
-- Allow anyone to read objects in the bucket
create policy "wpilogs read" on storage.objects
    for select using (bucket_id = 'wpilogs');

-- Allow anyone to upload new objects
create policy "wpilogs insert" on storage.objects
    for insert with check (bucket_id = 'wpilogs');

-- Allow anyone to delete (used by the Library "Delete" button)
create policy "wpilogs delete" on storage.objects
    for delete using (bucket_id = 'wpilogs');
```

### 4. Create the metadata table

In **SQL Editor** → **New query**, run:

```sql
create table if not exists public.logs (
    id           uuid        primary key default gen_random_uuid(),
    sha256       text        not null unique,
    file_name    text        not null,
    size_bytes   bigint      not null,
    event_tag    text        not null default 'Home',
    duration_sec numeric,
    storage_path text        not null,
    uploaded_at  timestamptz not null default now()
);

create index if not exists logs_event_tag_idx on public.logs (event_tag);
create index if not exists logs_uploaded_at_idx on public.logs (uploaded_at desc);

alter table public.logs enable row level security;

drop policy if exists "logs read"   on public.logs;
drop policy if exists "logs insert" on public.logs;
drop policy if exists "logs update" on public.logs;
drop policy if exists "logs delete" on public.logs;

create policy "logs read"   on public.logs for select using (true);
create policy "logs insert" on public.logs for insert with check (true);
create policy "logs update" on public.logs for update using (true) with check (true);
create policy "logs delete" on public.logs for delete using (true);
```

The `unique` constraint on `sha256` is what de-duplicates uploads — if you open the same file twice, the second `insert` is rejected and HawkDash transparently re-uses the existing row.

### 5. (Optional) Tweak preset event tags

Edit `PRESET_EVENT_TAGS` in `js/config.js` to seed the dropdown with the comps you expect this season. Any custom tag a user types ("New tag…" in the picker) is also saved and shows up in the chip filter the next time someone opens the library.

### Security note

These policies make the bucket fully public — anyone who has the deployed site URL can read, upload, and delete. That's fine for a team-internal tool that isn't widely linked. If you need stronger isolation, switch to Supabase auth and replace `using (true)` with `using (auth.role() = 'authenticated')` in the policies above.

## Implementation notes

- WPILOG parser: pure JS, implements the WPILib datalog v1.0 spec (header, control records, typed payloads). Decodes scalar primitives, arrays, JSON, and the common AdvantageKit struct types (`Pose2d`, `Translation2d`, `ChassisSpeeds`, `SwerveModuleState`).
- Charts: [uPlot](https://github.com/leeoniya/uPlot) via CDN (small, fast time-series).
- All parsing happens on the main thread for now; large logs (>50 MB) may take a few seconds to index.

## What gets read

The dashboard knows the log keys produced by the `Rebuilt2026` robot. See `js/keys.js` for the canonical list — it covers `/RealOutputs/...`, the per-subsystem `processInputs` prefixes (Vision, Swerve, Flywheel, Hood, Turret, Intake, Indexer, Beam), the `Alert` arrays, and the auto-logged `/SystemStats`, `/PowerDistribution`, `/DriverStation`, `/Timing` keys produced by `LoggedRobot`.
