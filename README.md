# CalSync

Self-hosted helper for Google Calendar: when you are busy on one calendar, CalSync mirrors **Busy** blocks onto the others in your sync group. OAuth refresh tokens and preferences live in `.data/store.json` on the machine that runs the app.

Clone the repo and copy **`.env.example`** to `.env.local` to configure Google OAuth and the public URL (see [Configure environment variables](#3-configure-environment-variables)).

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer (LTS recommended)
- A [Google Cloud](https://console.cloud.google.com/) project where you can enable APIs and create OAuth credentials

## Setup (step by step)

### 1. Install dependencies

From the project root:

```bash
npm install
```

### 2. Create Google OAuth credentials

1. In [Google Cloud Console](https://console.cloud.google.com/), select or create a project.
2. **APIs & Services → Library** — enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** — configure the app (type *External* is fine for personal use; add your Google account as a test user if the app stays in testing).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
5. Application type: **Web application**.
6. Under **Authorized redirect URIs**, add exactly:

   `http://localhost:3000/api/auth/callback`

   For production, add your public URL with the same path, e.g. `https://your-domain.com/api/auth/callback`.

7. Copy the **Client ID** and **Client secret**.

### 3. Configure environment variables

The repository includes **`.env.example`** as a safe template (no secrets). Copy it and fill in your values:

1. Copy the example env file:

   ```bash
   cp .env.example .env.local
   ```

2. Edit `.env.local` and set at minimum:

   | Variable | Description |
   |----------|-------------|
   | `GOOGLE_CLIENT_ID` | OAuth client ID from step 2 |
   | `GOOGLE_CLIENT_SECRET` | OAuth client secret from step 2 |
   | `CALSYNC_PUBLIC_URL` | Base URL with no trailing slash. Local: `http://localhost:3000`. Production: your HTTPS origin |

3. **Production:** set `CALSYNC_SESSION_SECRET` to a long random string so dashboard sessions are signed securely. Optionally set `CALSYNC_ALLOWED_EMAILS` to a comma-separated list of Google emails allowed to sign in.

See comments in `.env.example` for optional settings (webhook token, auto-sync interval, cron secret for renewing push subscriptions).

### 4. Run the app locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You will be redirected to sign in; use **Continue with Google**, then connect calendars on the dashboard.

### 5. Use the dashboard

After you sign in, the dashboard has two areas:

- **Upcoming events** — Lists events in the next 7, 30, or 90 days for calendars in your **saved** sync group only. Shows schedule, “free” transparency when Google marks the event that way, optional Meet/video links, and a link to open the event in Google Calendar.
- **Sync setup** — Connect or disconnect Google accounts, pick **Calendars in sync group** (choose at least two writable calendars you want kept in sync), **Save selection**, then **Run sync now** (or rely on push/polling if configured).

Refresh tokens and preferences are written to `.data/store.json` on this machine. Include `.data/` in backups if you move servers.

**API (optional):** Authenticated sessions can call `GET /api/events?days=30` (1–90) for JSON of the same upcoming-events window used by the dashboard.

### 6. Production build (optional)

```bash
npm run build
npm run start
```

Ensure `CALSYNC_PUBLIC_URL` matches the URL users use (HTTPS for Google Calendar push notifications). For serverless deployments, configure `CALSYNC_CRON_SECRET` and call `GET /api/cron/renew-watches` daily with `Authorization: Bearer <secret>` so push channel subscriptions stay valid.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run lint` | ESLint |

## Tech stack

This is a [Next.js](https://nextjs.org/) app (App Router) using the [Google Calendar API](https://developers.google.com/calendar) via `googleapis`.
