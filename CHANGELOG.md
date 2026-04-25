# Changelog

All notable changes to this project are documented in this file.

## [0.4.0] - 2026-04-25

### Added

- **Timezone Messages tab** — paste message text to instantly see all time mentions converted across multiple timezones; message text and selected timezones persist across sessions via `localStorage`.
- **Meeting start notifications** — browser notifications fire when a meeting is about to start, with a direct join button for video links.
- **Browser tab countdown** — tab title shows time remaining to the next meeting (e.g. `⏰ 12m — CalSync`).
- **Conflict badge shows event name** — the amber conflict pill now names the overlapping event.
- **App icon and favicon** — new CalSync logo set as favicon and documented in README.

### Fixed

- **Cross-account event deduplication** — linked-account calendar events no longer appear twice in the agenda.
- **RSVP for recurring events** — `timeMax` added and `timeMin` format corrected for "this and following" patch requests.
- **Bare hour times in timezone converter** — parser now handles `3pm` / `10am` in addition to `3:00 PM`.
- **Mobile notification settings** — settings page shows a fallback message on devices where `Notification` API is unavailable.
- **Timezone picker labels** — removed redundant UTC offset string from dropdown options.
- **Agenda first-item detection** — missing `gi` index in groups `map` callback no longer breaks top-padding logic.

## [0.3.6] - 2026-04-17

### Changed

- **Agenda grouping** — day sections use the **expanded** event list so dates stay correct when recurring instances are expanded.
- **Agenda layout (small screens)** — meeting join control sits in the title row; the wide-layout column stays for `sm` and up.
- **Event row spacing** — first row under each day heading (and under **Other**) uses top padding only; RSVP row alignment and gaps tightened slightly.

## [0.3.5] - 2026-04-17

### Added

- **`canRsvp`** on `GET /api/events` rows — `true` when you appear as an attendee (including linked-account email matches) or when you own the event as organizer/creator.
- **`.nvmrc`** (`22`) and **`engines.node`** in `package.json` — document supported Node major range (including Node 24+).

### Changed

- **`selfResponseStatus` / `declinedBySelf`** — resolved using **all linked Google account emails**, attendee rows that match those emails, and owner-created events without attendee entries (treated as accepted for display when you own the event).
- **`POST /api/events/rsvp`** — allows RSVP when you own the event but have no attendee row yet; patches Google Calendar by adding/updating a self attendee with the chosen status.
- **Conflict detection** (`computeConflictKeys`) — interval sweep after sorting by start time (same overlap results, less work on large lists).
- **`src/proxy.ts`** — removed redundant early `NextResponse.next()` branches for paths the stack already handles.

### Fixed

- **`.gitignore`** — ignore `node_modules_corrupt_*/` (local recovery folders).

## [0.3.4] - 2026-04-17

### Added

- **`GET /api/events?timeMin=<ISO>&timeMax=<ISO>`** — explicit event window (both required together). Enforces a maximum span (~40 days), reasonable past/future bounds, and returns `timeMin` / `timeMax` on the JSON response. Legacy **`days`** (1–30, rolling from server time) remains for older callers.
- **`POST /api/events/rsvp`** — session-authenticated RSVP updates (accept, tentative, decline) for events that include attendee data; patches the event via Google Calendar with `sendUpdates: none`.
- **`selfResponseStatus`** on `GET /api/events` payloads and **`getSelfResponseStatus`** in `src/lib/sync.ts` so the UI can show your response per event copy.

### Changed

- **Upcoming events — time range** — presets are **Next 7 days**, **This month** (now through end of current calendar month), and **Next month** (full following month), computed in the **browser’s local timezone** and requested via `timeMin` / `timeMax` (replacing fixed 7 / 30 / 90 rolling-day options).
- **Upcoming events — UI** — inline RSVP control (overlay select) with status dot and labels (Attending / Might attend / Can’t attend / RSVP); optimistic updates with rollback on error. Event rows emphasize account line with calendar icon; time strings use sentence-case am/pm; removed the separate “Declined” pill in favor of RSVP state.

## [0.3.3] - 2026-04-10

### Added

- FaceTime join-link support in event extraction and UI labels, including `facetime://` links and `facetime.apple.com` URLs.
- Description/notes meeting-link fallback parsing in `GET /api/events` so join links still surface when providers only embed them outside `conferenceData`.

### Changed

- Expanded event URL normalization/parsing for escaped slashes and HTML entities before matching meeting links.
- Dashboard and login interaction polish with pointer cursor treatment for clickable controls and explicit not-allowed cursor states for disabled actions.
- README dashboard docs now mention Google Meet, Zoom, and FaceTime links in upcoming events.

## [0.3.2] - 2026-04-09

### Added

- **Conflict badges** on the agenda: overlapping timed or all-day busy intervals are flagged with an amber “Conflict” pill; pairs where either side is a self-declined RSVP are ignored.
- **`describeLoginError`** (`src/lib/login-error.ts`): maps OAuth query errors (`invalid_state`, `access_denied`, `unauthorized_client`, `invalid_grant`, missing Google client env) to multi-line guidance on the login page and when the dashboard reads `?error=`.

### Changed

- **Meeting join links**: video icon, responsive labels (short on small screens, full text from `sm`), and clearer `aria-label`s; primary vs outline styling aligned with list-head emphasis.
- **Copy**: login, dashboard disconnected state, and footers now state that tokens and preferences live in the **instance database** (not only the device) and add an **experimental / use at your own risk** notice; removed outdated `.data/store.json` wording.
- **Layout**: slightly tighter main padding and gaps on small viewports; error alerts use `whitespace-pre-line` for multi-line messages.

## [0.3.1] - 2026-04-09

### Fixed

- Return JSON error bodies from `GET /api/calendars` and `GET /api/events` when Google Calendar API calls throw, instead of empty or HTML responses that broke `response.json()` in the browser.
- Parse calendar and events API responses from text on the dashboard so empty or non-JSON bodies show a clear error instead of “Unexpected end of JSON input”.
- Sync UX: “Run sync” uses the **saved** sync group from the server; the button stays disabled until at least two calendars are saved. Hints and empty-state copy explain when checkboxes are only a draft until **Save selection**.
- Save selection errors surface API `message` when present.

### Added

- On Google OAuth connect (first sign-in or **Add another Google account**), the new account’s **primary** calendar id is appended to the stored `syncCalendarIds` after pruning to allowed calendars.

## [0.3.0] - earlier

Initial tracked release in this changelog (see git history for prior detail).
