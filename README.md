# CalSync

Self-hosted helper for Google Calendar: when you are busy on one calendar, CalSync mirrors **Busy** blocks onto the others in your sync group. OAuth refresh tokens and preferences are stored per user in **Supabase** (Postgres). The app is **multi-user**: each Google sign-in gets an isolated CalSync account unless that Google identity was already linked (including via “Add another Google account”).

**Latest release:** v0.3.0 (2026-04-09). See [Changelog](#changelog).

Copy **`.env.example`** to **`.env.local`** and follow [Step-by-step setup](#step-by-step-setup), then [Run CalSync](#run-calsync). For a public HTTPS deployment, see [Recommended server configuration](#recommended-server-configuration).

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer (LTS recommended)
- A [Google Cloud](https://console.cloud.google.com/) project where you can enable APIs and create OAuth credentials
- A [Supabase](https://supabase.com/) project (free tier is fine) for the database

## Step-by-step setup

### 1. Clone the repository

```bash
git clone https://github.com/srizon/CalSync.git calsync
cd calsync
```

(Use your fork or mirror URL if different; the final argument sets the folder name.)

### 2. Install dependencies

From the project root:

```bash
npm install
```

### 3. Create Google OAuth credentials

1. In [Google Cloud Console](https://console.cloud.google.com/), select or create a project.
2. **APIs & Services → Library** — enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** — configure the app (type *External* is fine for personal use; add your Google account as a test user if the app stays in testing).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
5. Application type: **Web application**.
6. Under **Authorized redirect URIs**, add exactly:

   `http://localhost:3000/api/auth/callback`

   For production, add your public URL with the same path, e.g. `https://your-domain.com/api/auth/callback`.

7. Copy the **Client ID** and **Client secret**.

### 4. Create Supabase tables

1. In the Supabase dashboard, open **SQL Editor** and run the migration script from this repo: [`supabase/migrations/20260409120000_calsync_multiuser.sql`](supabase/migrations/20260409120000_calsync_multiuser.sql) (creates `calsync_users`, `calsync_identities`, `calsync_stores`, `calsync_watch_channels` with RLS enabled and no public policies — the app uses the **service role** from the server only).
2. Under **Project Settings → API**, copy the **Project URL** and the **service_role** key (keep the service role secret).

### 5. Configure environment variables

The repository includes **`.env.example`** as a safe template (no secrets). Copy it and fill in your values:

1. Copy the example env file:

   ```bash
   cp .env.example .env.local
   ```

2. Edit `.env.local` and set at minimum:

   | Variable | Description |
   |----------|-------------|
   | `GOOGLE_CLIENT_ID` | OAuth client ID from step 3 |
   | `GOOGLE_CLIENT_SECRET` | OAuth client secret from step 3 |
   | `SUPABASE_URL` | Supabase project URL (step 4) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only; step 4) |
   | `CALSYNC_PUBLIC_URL` | Base URL with no trailing slash. Local: `http://localhost:3000`. Production: your HTTPS origin |

3. **Production:** set `CALSYNC_SESSION_SECRET` to a long random string so dashboard sessions are signed securely. Optionally set `CALSYNC_ALLOWED_EMAILS` to a comma-separated list of Google emails allowed to sign in.

**Migrating from older CalSync** that used `.data/store.json`: leave that file in place on first start after upgrading. If the Supabase database has no users yet, the app **imports** the legacy file into a single CalSync user and renames the file to `store.json.migrated`.

See comments in `.env.example` for optional settings (webhook token, auto-sync interval, cron secret for renewing push subscriptions).

## Run CalSync

### Run in development

From the project root (with `.env.local` filled in):

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You will be redirected to sign in; use **Continue with Google**, then connect calendars on the dashboard.

The dev server uses the default Next.js port **3000**. To use another port:

```bash
npx next dev -p 3001
```

Set `CALSYNC_PUBLIC_URL` to match (e.g. `http://localhost:3001`).

### Run in production (same machine or server)

Build once, then start the Node server:

```bash
npm run build
npm run start
```

By default the app listens on **port 3000**. Set the `PORT` environment variable to listen on another port (for example `PORT=8080 npm run start`).

Ensure `CALSYNC_PUBLIC_URL` matches the URL users and Google OAuth actually use (HTTPS in production). Google Calendar **push** notifications require an HTTPS public URL; without HTTPS, push-related features are skipped (the cron route returns `no_https_public_url` when push is unavailable).

## Recommended server configuration

Use these guidelines when CalSync runs on a VPS, homelab host, or similar always-on environment.

**Compute and Node**

- **Node.js** 20 LTS or newer on the server.
- **Sizing:** CalSync is mostly I/O to Google’s APIs. A small VM (about **1 vCPU**, **512 MB–1 GB RAM**) is often enough; add headroom if you run other services on the same host.

**Storage**

- **Supabase** holds all user data (tokens, sync selection, push channel metadata). Use Supabase backups and point `SUPABASE_*` at the same project for production. Legacy **`.data/store.json`** is only read once for automatic import, then renamed; you can remove `.data/` after a successful migration.

**HTTPS and reverse proxy**

- Terminate **TLS** at a reverse proxy (e.g. **Caddy**, **nginx**, or **Traefik**) or your platform’s load balancer, and proxy to the Next.js process.
- **Proxy target:** `http://127.0.0.1:<PORT>` where `<PORT>` matches `PORT` for `npm run start` (default 3000). Binding only to localhost is fine when the proxy is on the same machine.
- Forward **`Host`**, **`X-Forwarded-Proto`**, and **`X-Forwarded-For`** so redirects and OAuth stay aligned with `CALSYNC_PUBLIC_URL`.

**Production environment variables**

| Priority | Variable | Notes |
|----------|----------|--------|
| Required | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From Google Cloud OAuth client (Web application). |
| Required | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | From Supabase **Project Settings → API**; service role is server-only (never expose in the browser). |
| Required | `CALSYNC_PUBLIC_URL` | Public HTTPS origin, **no trailing slash** (must match what users open in the browser). |
| Required | `CALSYNC_SESSION_SECRET` | Long random string; signs the dashboard session cookie. |
| Recommended | `CALSYNC_ALLOWED_EMAILS` | Comma-separated Google accounts allowed to sign in (useful on the public internet). |
| Recommended | `CALSYNC_WEBHOOK_TOKEN` | If set, Google Calendar push requests must send the same value in `X-Goog-Channel-Token`. |
| Recommended | `CALSYNC_CRON_SECRET` | Protects `GET /api/cron/renew-watches` with `Authorization: Bearer <secret>`. |
| Optional | `CALSYNC_AUTO_SYNC_INTERVAL_SEC` | Poll sync every *N* seconds while the Node process runs (e.g. `120`) as a complement to push. |

**Cron for push channel renewal**

Google push channels expire after roughly a week. Schedule a **daily** HTTPS request (same host as `CALSYNC_PUBLIC_URL`):

```bash
curl -fsS -H "Authorization: Bearer YOUR_CALSYNC_CRON_SECRET" \
  "https://your-domain.com/api/cron/renew-watches"
```

Set `CALSYNC_CRON_SECRET` in `.env.local` (or your process manager’s environment) to match `YOUR_CALSYNC_CRON_SECRET`.

**Process supervision**

Run `npm run start` under a supervisor so it restarts after reboots or crashes—for example **systemd**, **PM2**, or your platform’s native service model. Example **systemd** unit (adjust paths and user):

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

Install Node via your distro or **nvm** so `npm` and `node` are on `PATH` for the service user, or set `ExecStart` to the full path of `next` / `node` as needed.

**Google Cloud Console**

- Add the production **Authorized redirect URI**: `https://your-domain.com/api/auth/callback` (same path pattern as local, HTTPS origin only).

## Using the dashboard

After you sign in, the dashboard uses two tabs:

- **Upcoming events** (default) — Lists events in the next 7, 30, or 90 days for calendars in your **saved** sync group only. Shows schedule, “free” transparency when Google marks the event that way, optional Meet/video links, and a link to open the event in Google Calendar. Use **Declined events** to show or hide invitations you declined (hidden by default; shown rows are muted with a **Declined** badge). The list uses a short loading skeleton, refreshes in the background about every minute while the tab is visible, and reloads after sync and clear-mirrors actions.
- **Sync setup** — Manage Google accounts and the sync group:
  - **Connected Google accounts** — Add another account, remove one, or **Disconnect all**. Calendars from every linked account appear under that account’s email; busy blocks can sync across different Google logins.
  - **Calendars in sync group** — Check at least two calendars that should both publish and receive busy mirrors. The list is grouped by account, with the **primary** calendar first in each group; only calendar display names are shown (not raw calendar IDs). Each calendar must be writable (owner or “Make changes to events”) on at least one connected account. Use **Add calendar** to **Create** a new calendar (optionally choose which account owns it when you have several) or **Add to list** with an existing calendar ID from Google Calendar → Settings → Integrate calendar. Then **Save selection** and **Run sync now**, or rely on HTTPS push notifications and optional polling (see [Configure environment variables](#5-configure-environment-variables)).
  - After a sync, **Last sync** shows created/updated/deleted mirror counts, how many event rows Google returned, and (when relevant) why some events were skipped (e.g. “Show as available”, existing CalSync mirrors, cancelled events).

Refresh tokens and preferences live in your **Supabase** project. Back up and secure that database; the app does not persist tokens on local disk except during a one-time legacy import from `.data/store.json`.

**API (optional):** Authenticated sessions can call `GET /api/events?days=30` (1–90) for JSON of the same upcoming-events window used by the dashboard. Each event object includes `declinedBySelf` when your RSVP on that event is *Declined*. You can trigger a sync with `POST /api/sync` (same session cookie) or from automation if you expose it appropriately. To strip only CalSync mirror blocks from one calendar (not your real events), `POST /api/calendars/clear-mirrors` with JSON `{ "calendarId": "<id>" }`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server (Turbopack) |
| `npm run dev:webpack` | Development server using Webpack |
| `npm run build` | Production build (Turbopack) |
| `npm run build:webpack` | Production build using Webpack |
| `npm run start` | Run production server |
| `npm run lint` | ESLint |

## Changelog

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

- **Core:** Next.js 16 (App Router), Google OAuth, busy-block mirroring across a chosen calendar group, local persistence in `.data/store.json`, optional push notifications and cron for watch renewal (see env docs).
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
