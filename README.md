# CalSync

<div align="center">
  <img src="public/logo.png" alt="CalSync Logo" width="120" />
</div>


Self-hosted Google Calendar helper that mirrors **Busy** blocks across accounts using explicit **mirror rules**. Each rule directs busy events from one or more source calendars (on any connected Google account) into a destination calendar on a different account — so the destination account always shows when you are busy, without exposing event details. OAuth refresh tokens and mirror rules are stored per user in **Supabase** (Postgres). The app is **multi-user**: each Google sign-in gets an isolated CalSync account unless that Google identity was already linked (including via “Add another Google account”).

**Latest release:** v0.4.0 (2026-04-25). See [Changelog](#changelog). **Release history:** [`CHANGELOG.md`](CHANGELOG.md).

Copy **`.env.example`** to **`.env.local`** and follow [Step-by-step setup](#step-by-step-setup), then [Run CalSync](#run-calsync). For a public HTTPS deployment, see [Recommended server configuration](#recommended-server-configuration).

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer (LTS recommended)
- A [Google Cloud](https://console.cloud.google.com/) project (Calendar API + OAuth web client)
- A [Supabase](https://supabase.com/) project for the database

## Step-by-step setup

### 1. Clone the repository

```bash
git clone https://github.com/srizon/CalSync.git calsync
cd calsync
```

Use your fork or mirror URL if different; the last argument is the folder name.

### 2. Install dependencies

```bash
npm install
```

### 3. Create Google OAuth credentials

1. In Google Cloud Console, select or create a project.
2. **APIs & Services → Library** — enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** — configure the app (*External* is fine for personal use; add test users while in testing).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** — type **Web application**.
5. **Authorized redirect URIs** — add your callback URLs (same path for every origin):

   - Local: `http://localhost:3000/api/auth/callback` (adjust host/port if you change the dev server; set `CALSYNC_PUBLIC_URL` to match.)
   - Production: `https://your-domain.com/api/auth/callback`

6. Copy the **Client ID** and **Client secret**.

### 4. Create Supabase tables

1. In the Supabase dashboard, open **SQL Editor** and run the migration script from this repo: [`supabase/migrations/20260409120000_calsync_multiuser.sql`](supabase/migrations/20260409120000_calsync_multiuser.sql) (creates `calsync_users`, `calsync_identities`, `calsync_stores`, `calsync_watch_channels` with RLS enabled and no public policies — the app uses the **service role** from the server only).
2. Under **Project Settings → API**, copy the **Project URL** and the **service_role** key (keep it secret; under "Secret keys" — click the eye icon to reveal it; starts with `sb_secret_` on newer dashboards, or use the "Legacy anon, service_role API keys" tab if your dashboard still shows legacy keys).

### 5. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` using the reference table below and the comments in `.env.example`. Optional settings (webhook token, auto-sync interval, cron secret) are documented there.

**Legacy import:** If you are upgrading from a build that used `.data/store.json`, leave that file in place on first start. When the Supabase database has no users yet, the app imports it for a single user and renames the file to `store.json.migrated`.

## Environment variables

| Variable | When | Description |
|----------|------|-------------|
| `GOOGLE_CLIENT_ID` | Always | OAuth client ID from Google Cloud |
| `GOOGLE_CLIENT_SECRET` | Always | OAuth client secret |
| `SUPABASE_URL` | Always | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Always | Service role key (server only; never expose to the browser) |
| `CALSYNC_PUBLIC_URL` | Always | Public base URL with **no** trailing slash (`http://localhost:3000` locally; HTTPS origin in production). Must match what users and OAuth use. |
| `CALSYNC_SESSION_SECRET` | Production | Long random string; signs the dashboard session cookie |
| `CALSYNC_ALLOWED_EMAILS` | Optional | Comma-separated Google emails allowed to sign in (useful on the public internet) |
| `CALSYNC_WEBHOOK_TOKEN` | Optional | If set, Google push requests must send the same value in `X-Goog-Channel-Token` |
| `CALSYNC_CRON_SECRET` | Optional | Protects `GET /api/cron/renew-watches` with `Authorization: Bearer <secret>` |
| `CALSYNC_AUTO_SYNC_INTERVAL_SEC` | Optional override | Poll sync every *N* seconds while the process runs. Defaults to `30` if unset; set `0` to disable polling. |
| `CALSYNC_SYNC_COALESCE_TIMEOUT_SEC` | Optional | Max seconds a coalesced auto-sync can hold the in-memory per-user lock before stale-lock recovery (default `300`) |

Google Calendar **push** needs a public **HTTPS** URL. Without it, push-related behavior is skipped (the cron route may report `no_https_public_url`).

## Run CalSync

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in with Google, then configure calendars on the dashboard.

Default port is **3000**. For another port:

```bash
npx next dev -p 3001
```

Set `CALSYNC_PUBLIC_URL` accordingly (e.g. `http://localhost:3001`).

### Production

```bash
npm run build
npm run start
```

Default listen port is **3000**; override with `PORT` (e.g. `PORT=8080 npm run start`). Ensure `CALSYNC_PUBLIC_URL` matches the URL users and Google OAuth use (HTTPS in production).

## Recommended server configuration

For a VPS, homelab host, or similar always-on deployment:

**Compute:** Node.js 20 LTS or newer. CalSync is mostly I/O to Google; a small VM (about **1 vCPU**, **512 MB–1 GB** RAM) is often enough.

**Data:** Supabase holds tokens, sync selection, and push metadata—use backups and the same `SUPABASE_*` values in production. After a successful legacy migration, `.data/` is optional; `.data/store.json` is only read once then renamed.

**HTTPS and reverse proxy:** Terminate TLS at **Caddy**, **nginx**, **Traefik**, or your platform LB; proxy to `http://127.0.0.1:<PORT>` (match `PORT` for `npm run start`). Forward **`Host`**, **`X-Forwarded-Proto`**, and **`X-Forwarded-For`** so redirects align with `CALSYNC_PUBLIC_URL`.

**Cron (push renewal):** Channels expire about weekly. Schedule a daily HTTPS request:

```bash
curl -fsS -H "Authorization: Bearer YOUR_CALSYNC_CRON_SECRET" \
  "https://your-domain.com/api/cron/renew-watches"
```

Set `CALSYNC_CRON_SECRET` to match. Environment variables are summarized in [Environment variables](#environment-variables).

**Process supervision:** Run `npm run start` under **systemd**, **PM2**, or equivalent. Example **systemd** unit (adjust paths and user):

```ini
[Unit]
Description=CalSync Next.js
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/calsync
Environment=NODE_ENV=production
Environment=PORT=3000
EnvironmentFile=/opt/calsync/.env.local
ExecStart=/usr/bin/npm run start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Ensure `node`/`npm` are on `PATH` for the service user, or use full paths in `ExecStart`.

## Using the dashboard

- **Upcoming events** (default) — Lists events in the next 7 days, this month, or next month for calendars in your **saved** sync group only. Shows schedule, “free” transparency when Google marks the event that way, optional Meet/Zoom/FaceTime video links, and a link to open the event in Google Calendar. **RSVP** — accept, tentatively accept, or decline directly from the row when Google returns attendee data. Overlapping busy intervals show a **Conflict** badge naming the other event (self-declined RSVPs excluded). **Declined events** toggles invitations you declined. The list refreshes in the background about every minute while visible, and reloads after sync and clear-mirrors actions. The **browser tab title** counts down to the next meeting.
- **Notifications** — Grant browser notification permission in **Settings** to receive a popup when a meeting is about to start; the notification includes a **Join** button for events with a video link. Devices without `Notification` API support see an explanatory message instead.
- **Timezone Messages** — Paste any message containing times (e.g. `3pm`, `10:30 AM`) and pick one or more target timezones; CalSync converts every time mention inline and appends your local timezone automatically. Message text and timezone selections persist across sessions.
- **Sync setup** — Manage Google accounts and mirror rules:
  - **Connected Google accounts** — Add another account, remove one, or **Disconnect all**. Calendars from every linked account are available for use in mirror rules.
  - **Mirror rules** — Each rule defines a directed sync: pick a **source account** and one or more **source calendars** to read busy blocks from, then pick a **destination account** and **destination calendar** to write the mirrors into. Source and destination must be different Google accounts. Set the destination calendar to **”Auto (CalSync calendar)”** to let CalSync find or create a calendar named “CalSync” on the destination account automatically. You can have multiple rules — for example, mirror your work calendar into your personal account and vice versa.
  - **Save rules** persists the configuration and registers Google Calendar push notifications if HTTPS is available. **Run sync now** triggers an immediate sync.
  - After a sync, **Last sync** shows created/updated/deleted mirror counts, how many event rows Google returned, and (when relevant) why some events were skipped (e.g. “Show as available”, existing CalSync mirrors, cancelled events, declined invitations).

Refresh tokens and preferences live in your **Supabase** project. Back up and secure that database; the app does not persist tokens on local disk except during a one-time legacy import from `.data/store.json`.

**API (session-authenticated):** `GET /api/events?timeMin=<ISO>&timeMax=<ISO>` (both required together; max span about 40 days), or legacy `GET /api/events?days=30` (1–30 rolling window from server time). Response includes `timeMin` / `timeMax` echo and `staleAccounts`. `POST /api/sync`. `POST /api/calendars/clear-mirrors` with `{ “calendarId”: “<id>” }`. `POST /api/events/rsvp` with `{ “calendarId”: “<id>”, “eventId”: “<id>”, “responseStatus”: “accepted” | “tentative” | “declined” }`. Retrieve or update mirror rules with `GET /api/config` and `PUT /api/config` (body: `{ “mirrorRules”: [...] }`). Event objects include `declinedBySelf`, `selfResponseStatus`, and `canRsvp`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server |
| `npm run dev:webpack` | Development server (Webpack) |
| `npm run build` | Production build |
| `npm run build:webpack` | Production build (Webpack) |
| `npm run start` | Production server |
| `npm run lint` | ESLint |

## Changelog

### [0.4.0] — 2026-04-25

- **Timezone Messages tab** — paste message text to see all time mentions converted across multiple timezones; message text and selected timezones persist across sessions via `localStorage`.
- **Meeting start notifications** — browser notifications fire when a meeting is about to start, with a direct join button for video links.
- **Browser tab countdown** — tab title shows time remaining to the next meeting.
- **Conflict badge names the event** — the amber conflict pill now shows the name of the overlapping event.
- **App icon and favicon** — new CalSync logo.
- **Cross-account event deduplication** — linked-account calendar events no longer appear twice in the agenda.
- **Bare hour times in timezone converter** — parser handles `3pm` / `10am` in addition to `3:00 PM`.

### [0.3.1] — 2026-04-09

- **Directed mirror rules:** Replaced the flat N×N “sync group” model with explicit `MirrorRule` objects. Each rule specifies a source account, one or more source calendars, a destination account, and a destination calendar (`__auto__` to find/create a “CalSync” calendar automatically). Rules are validated on save (non-empty source calendars, source ≠ destination account, both accounts must be connected).
- **Sync engine rewrite:** `runDirectedMirrorSync` replaces the old N×N fan-out. Uses direct per-account API clients instead of probing all accounts per calendar. Calendar labels fetched in parallel with `Promise.allSettled`.
- **Auto-calendar persistence:** Resolved `__auto__` destination calendar IDs are written back to the store so repeated syncs skip the `calendarList` + `calendar.insert` round-trip.
- **Push notification fix:** Watch channels now register for any rule with at least one source calendar (was previously skipped when fewer than two calendars were watched).
- **API:** `GET /api/config` returns `mirrorRules`; `PUT /api/config` accepts and validates the new rule format.

### [0.3.0] — 2026-04-09

- **Multi-user + Supabase:** Each distinct Google identity maps to a CalSync user (unless you use **Add another Google account** while signed in). Data lives in Supabase Postgres (`calsync_users`, `calsync_identities`, `calsync_stores`, `calsync_watch_channels`). Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. One-time import from legacy `.data/store.json` when the database is empty.
- **Sessions:** Dashboard cookie now carries an internal `userId`; older email-only cookies still work until they expire if the identity exists in Supabase.
- **Background jobs:** Auto-sync, watch renewal, cron, and calendar webhooks operate per user; push webhooks resolve the user via `x-goog-channel-id`.

### [0.2.0] — 2026-04-08

- **Documentation:** Step-by-step setup starts with **clone** instructions; **Run CalSync** covers dev (default port, `npx next dev -p …`) and production (`npm run build` / `npm run start`, `PORT`). New **Recommended server configuration** section: VM sizing, persisting **`.data/`**, reverse proxy headers (`Host`, `X-Forwarded-Proto`, `X-Forwarded-For`), production env variable table, daily **cron** example for `GET /api/cron/renew-watches`, example **systemd** unit, and production OAuth redirect URI. Cross-links use the updated “configure environment variables” step number.
- **Events API:** `GET /api/events` returns declined invitations in the payload instead of omitting them; each row includes **`declinedBySelf`** so clients can filter or style them.
- **Agenda UI:** **Declined events** toggle (default off) with muted row styling, **Declined** pill, and softer list-head and join-link treatment when shown; empty state when only declined rows exist while the toggle is off. **EventsAgendaSkeleton** while loading; **silent** refetch about every 60 seconds when the document is visible; shared **`loadEvents`** with abort on unmount; event list refresh after sync, clear mirrors, and related actions.
- **Agenda layout:** Custom-styled time-range `<select>`; row borders and padding adjusted for the first agenda item.
- **Sync setup UI:** **Calendars in sync group** are grouped under each Google account (email label). Within each account, the **primary** calendar is listed first, then other calendars by name. Raw calendar IDs are no longer shown in the list (display names and the **primary** badge only).

### [0.1.0] — 2026-04-03

- **Core:** Next.js 16 (App Router), Google OAuth, busy-block mirroring, local persistence in `.data/store.json` (superseded by Supabase in v0.3.0), optional push notifications and cron for watch renewal (see env docs).
- **Dashboard:** **Upcoming events** and **Sync setup** tabs; calendars merged across linked Google accounts; last-sync summary with skip reasons.
- **API:** `GET /api/events?days=…` (1–90), `POST /api/sync`, `POST /api/calendars/clear-mirrors` (session-authenticated).
- **Tooling:** `npm run dev` / `npm run build` (Turbopack); optional `npm run dev:webpack` and `npm run build:webpack`.
- **Declined invitations:** Events where your RSVP is *Declined* are omitted from the upcoming list, are not sources for mirrors, and sync skip stats can include `declinedByYou`.
- **Clear mirrors:** Per-calendar control on Sync setup (and the clear-mirrors API) deletes CalSync mirror events over a wide past range plus the normal forward window; your own non-mirror events are untouched.
- **Sync cleanup:** Duplicate CalSync mirrors on the same target (same mirror key) are deleted during sync.
- **UI:** Calendar create/add flows were removed from the home page in favor of managing the sync group and calendars in Google Calendar / settings.
- **Agenda:** The upcoming-events list hides items that have already ended (timed and all-day); the view refreshes when the next event in range ends. List-head badges use urgency colors (calm → urgent) from time until start or, for live timed events, time until end. The footer shows how many events are still on the agenda versus how many in the window already ended, with a clear empty state when everything in range is past.
- **Login:** OAuth error text from the query string is read with `useSearchParams` inside a `Suspense` boundary so static generation and ESLint stay clean.


## Tech stack

[Next.js](https://nextjs.org/) 16 (App Router), [React](https://react.dev/) 19, [Tailwind CSS](https://tailwindcss.com/) 4, [Supabase](https://supabase.com/) (Postgres), and the [Google Calendar API](https://developers.google.com/calendar) via [`@googleapis/calendar`](https://www.npmjs.com/package/@googleapis/calendar) and [`google-auth-library`](https://www.npmjs.com/package/google-auth-library).
