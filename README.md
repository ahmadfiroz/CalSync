# CalSync

Self-hosted helper for Google Calendar: when you are busy on one calendar, CalSync mirrors **Busy** blocks onto the others in your sync group. OAuth refresh tokens and preferences are stored per user in **Supabase** (Postgres). The app is **multi-user**—each Google sign-in gets an isolated account unless that identity was already linked (including via “Add another Google account”).

**Version:** see `package.json`. **Release history:** [`CHANGELOG.md`](CHANGELOG.md).

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

1. In the Supabase **SQL Editor**, run [`supabase/migrations/20260409120000_calsync_multiuser.sql`](supabase/migrations/20260409120000_calsync_multiuser.sql). This creates `calsync_users`, `calsync_identities`, `calsync_stores`, and `calsync_watch_channels` with RLS and no public policies—the app uses the **service role** on the server only.
2. Under **Project Settings → API**, copy the **Project URL** and the **service_role** key (keep it secret).

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
| `CALSYNC_AUTO_SYNC_INTERVAL_SEC` | Optional | Poll sync every *N* seconds while the process runs (e.g. `120`), in addition to push |

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

- **Upcoming events** — Next 7, 30, or 90 days for calendars in your **saved** sync group. Shows schedule, free transparency, optional Meet links, and a link to Google Calendar. Overlapping busy intervals show a **Conflict** badge (self-declined RSVPs excluded). **Declined events** toggles invitations you declined. The list refreshes in the background about every minute while visible, and after sync or clear-mirrors.
- **Sync setup** — **Connected Google accounts** (add/remove, disconnect all). **Calendars in sync group** — choose at least two writable calendars; grouped by account with the **primary** calendar first. **Add calendar** creates a new calendar or adds by ID. **Save selection**, then **Run sync now**, or rely on push and optional polling (`CALSYNC_AUTO_SYNC_INTERVAL_SEC`). **Last sync** shows mirror counts and skip reasons.

Tokens and preferences live in **Supabase**; secure and back up that database.

**API (session-authenticated):** `GET /api/events?days=30` (1–90), `POST /api/sync`, `POST /api/calendars/clear-mirrors` with `{ "calendarId": "<id>" }`. Event objects can include `declinedBySelf`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server |
| `npm run dev:webpack` | Development server (Webpack) |
| `npm run build` | Production build |
| `npm run build:webpack` | Production build (Webpack) |
| `npm run start` | Production server |
| `npm run lint` | ESLint |

## Tech stack

[Next.js](https://nextjs.org/) 16 (App Router), [React](https://react.dev/) 19, [Tailwind CSS](https://tailwindcss.com/) 4, [Supabase](https://supabase.com/) (Postgres), and the [Google Calendar API](https://developers.google.com/calendar) via [`@googleapis/calendar`](https://www.npmjs.com/package/@googleapis/calendar) and [`google-auth-library`](https://www.npmjs.com/package/google-auth-library).
