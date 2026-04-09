# Changelog

All notable changes to this project are documented in this file.

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
