# Changelog

All notable changes to this project are documented in this file.

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
