import { NextRequest, NextResponse } from "next/server";
import type { calendar_v3 } from "@googleapis/calendar";
import { isStoreConnected } from "@/lib/store";
import { readStoreForUser } from "@/lib/store-db";
import { resolveClientForCalendar } from "@/lib/accounts";
import { CALSYNC_SOURCE_KEY } from "@/lib/constants";
import {
  getSelfResponseStatus,
  listAllEvents,
} from "@/lib/sync";
import { listCalendarsMerged } from "@/lib/calendar-directory";
import { requireUserId } from "@/lib/api-session";
import { MAX_EVENTS_WINDOW_MS } from "@/lib/events-window";

export const runtime = "nodejs";

/** Legacy `days=` rolling window (1…30). Prefer `timeMin` + `timeMax`. */
const MAX_RANGE_DAYS = 30;

const MAX_TIME_MAX_AHEAD_MS = 450 * 24 * 60 * 60 * 1000;
const MAX_TIME_MIN_BEHIND_MS = 48 * 60 * 60 * 1000;

function parseEventsWindow(req: NextRequest):
  | { ok: true; timeMin: Date; timeMax: Date; legacyDays?: number }
  | {
      ok: false;
      status: number;
      body: Record<string, unknown>;
    } {
  const timeMinStr = req.nextUrl.searchParams.get("timeMin");
  const timeMaxStr = req.nextUrl.searchParams.get("timeMax");
  const hasMin = timeMinStr != null;
  const hasMax = timeMaxStr != null;
  if (hasMin !== hasMax) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "invalid_window",
        message:
          "Send both timeMin and timeMax as ISO 8601 strings, or omit both and use the legacy days parameter.",
      },
    };
  }
  if (hasMin && hasMax) {
    const timeMin = new Date(timeMinStr);
    const timeMax = new Date(timeMaxStr);
    if (
      !Number.isFinite(timeMin.getTime()) ||
      !Number.isFinite(timeMax.getTime())
    ) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "invalid_window",
          message: "timeMin and timeMax must be valid ISO 8601 datetimes.",
        },
      };
    }
    if (timeMin.getTime() >= timeMax.getTime()) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "invalid_window",
          message: "timeMin must be before timeMax.",
        },
      };
    }
    const span = timeMax.getTime() - timeMin.getTime();
    if (span > MAX_EVENTS_WINDOW_MS) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "invalid_window",
          message: "Requested time range is too wide.",
        },
      };
    }
    const now = Date.now();
    if (timeMin.getTime() < now - MAX_TIME_MIN_BEHIND_MS) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "invalid_window",
          message: "timeMin is too far in the past.",
        },
      };
    }
    if (timeMax.getTime() > now + MAX_TIME_MAX_AHEAD_MS) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "invalid_window",
          message: "timeMax is too far in the future.",
        },
      };
    }
    return { ok: true, timeMin, timeMax };
  }

  let days = Number(req.nextUrl.searchParams.get("days") ?? "7");
  if (!Number.isFinite(days) || days < 1) days = 7;
  days = Math.min(Math.floor(days), MAX_RANGE_DAYS);
  const timeMin = new Date();
  const timeMax = new Date(timeMin);
  timeMax.setDate(timeMax.getDate() + days);
  return { ok: true, timeMin, timeMax, legacyDays: days };
}

const URL_IN_TEXT = /(https?:\/\/|facetime:\/\/)[^\s<>\]"')]+/gi;
const FACETIME_BARE_IN_TEXT = /\bfacetime\.apple\.com\/[^\s<>\]"')]+/gi;

function trimTrailingUrlJunk(s: string): string {
  return s.replace(/[.,;:)]+$/, "");
}

function normalizeUrlishText(s: string): string {
  // Calendar descriptions can contain JSON-escaped slashes and HTML entities.
  return s
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/");
}

function isPreferredMeetingHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "facetime.apple.com" ||
    h.endsWith(".facetime.apple.com") ||
    h === "zoom.us" ||
    h.endsWith(".zoom.us") ||
    h.includes("meet.google") ||
    h.includes("teams.microsoft") ||
    h.includes("webex.com")
  );
}

/** Zoom, FaceTime, and other non-Meet links are often only in `location`, not conferenceData. */
function meetingUrlFromLocation(
  location: string | null | undefined
): string | null {
  if (!location?.trim()) return null;
  const matches = location.match(URL_IN_TEXT);
  if (!matches?.length) return null;

  const candidates = matches.map(trimTrailingUrlJunk);

  for (const m of candidates) {
    try {
      const u = new URL(m);
      if (isPreferredMeetingHost(u.hostname)) return m;
    } catch {
      /* ignore */
    }
  }

  for (const m of candidates) {
    try {
      new URL(m);
      return m;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function firstMeetingUrlFromText(
  text: string | null | undefined
): string | null {
  if (!text?.trim()) return null;
  const normalized = normalizeUrlishText(text);
  const directMatches = normalized.match(URL_IN_TEXT) ?? [];
  const facetimeBare = (normalized.match(FACETIME_BARE_IN_TEXT) ?? []).map(
    (m) => `https://${m}`
  );
  const candidates = [...directMatches, ...facetimeBare].map(trimTrailingUrlJunk);
  if (!candidates.length) return null;

  for (const m of candidates) {
    try {
      const u = new URL(m);
      if (isPreferredMeetingHost(u.hostname)) return m;
    } catch {
      /* ignore */
    }
  }

  for (const m of candidates) {
    try {
      new URL(m);
      return m;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function meetingUrlFromEvent(ev: calendar_v3.Schema$Event): string | null {
  if (ev.hangoutLink) return ev.hangoutLink;
  const eps = ev.conferenceData?.entryPoints;
  if (eps?.length) {
    const video = eps.find((e) => e.entryPointType === "video");
    if (video?.uri) return video.uri;
    const any = eps.find((e) => e.uri);
    if (any?.uri) return any.uri;
  }
  const fromLocation = meetingUrlFromLocation(ev.location);
  if (fromLocation) return fromLocation;
  const fromDescription = firstMeetingUrlFromText(ev.description);
  if (fromDescription) return fromDescription;
  return firstMeetingUrlFromText(ev.conferenceData?.notes);
}

function isInvalidGrant(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.toLowerCase().includes("invalid_grant");
}

function getSelfRsvp(ev: calendar_v3.Schema$Event): string | null {
  const attendee = ev.attendees?.find((a) => a.self === true);
  return attendee?.responseStatus ?? null;
}

function rowStartMs(
  start: calendar_v3.Schema$EventDateTime | null | undefined
): number {
  if (start?.dateTime) {
    const t = new Date(start.dateTime).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (start?.date) {
    const t = new Date(`${start.date}T12:00:00`).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

function userOwnsEvent(
  ev: calendar_v3.Schema$Event,
  accountEmails: Set<string>
): boolean {
  if (ev.organizer?.self === true || ev.creator?.self === true) return true;
  const organizerEmail = ev.organizer?.email?.trim().toLowerCase();
  if (organizerEmail && accountEmails.has(organizerEmail)) return true;
  const creatorEmail = ev.creator?.email?.trim().toLowerCase();
  return Boolean(creatorEmail && accountEmails.has(creatorEmail));
}

function selfResponseStatusForAccount(
  ev: calendar_v3.Schema$Event,
  accountEmails: Set<string>
): string | null {
  const bySelf = getSelfResponseStatus(ev);
  if (bySelf) return bySelf;
  const byEmail = (ev.attendees ?? []).find(
    (a) =>
      typeof a.email === "string" &&
      accountEmails.has(a.email.trim().toLowerCase()) &&
      Boolean(a.responseStatus)
  );
  if (byEmail?.responseStatus) return byEmail.responseStatus;
  if (userOwnsEvent(ev, accountEmails)) {
    // Owner-created events without attendee rows are effectively accepted by self.
    return "accepted";
  }
  return null;
}

export async function GET(req: NextRequest) {
  const parsed = parseEventsWindow(req);
  if (!parsed.ok) {
    return NextResponse.json(parsed.body, { status: parsed.status });
  }
  const { timeMin, timeMax } = parsed;
  const legacyDays = parsed.legacyDays;

  try {
    const userId = await requireUserId();
    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const s = await readStoreForUser(userId);
    if (!isStoreConnected(s)) {
      return NextResponse.json({ error: "not_connected" }, { status: 401 });
    }

    const dir = await listCalendarsMerged(s);
    if (!dir) {
      return NextResponse.json({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        ...(legacyDays !== undefined ? { days: legacyDays } : {}),
        events: [],
        loadErrors: [],
        staleAccounts: [],
      });
    }

    // Show events from all source calendars across all mirror rules
    const sourceCalIds = new Set(
      (s.mirrorRules ?? []).flatMap((r) => r.sourceCals)
    );
    const selectedCals = dir.calendars.filter((c) => sourceCalIds.has(c.id));
    if (!selectedCals.length) {
      return NextResponse.json({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        ...(legacyDays !== undefined ? { days: legacyDays } : {}),
        events: [],
        loadErrors: [],
        staleAccounts: dir.staleAccounts,
      });
    }

    const loadErrors: string[] = [];
    // Start with accounts already detected stale by listCalendarsMerged
    const staleAccounts: string[] = [...dir.staleAccounts];
    const linkedAccountEmails = new Set(
      s.accounts
        .map((a) => a.email?.trim().toLowerCase())
        .filter((x): x is string => Boolean(x))
    );
    const rows: {
      calendarId: string;
      calendarSummary: string;
      accountEmail: string | null;
      id: string | null;
      summary: string | null;
      start: calendar_v3.Schema$EventDateTime | null;
      end: calendar_v3.Schema$EventDateTime | null;
      htmlLink: string | null;
      transparency: string | null;
      meetingUrl: string | null;
      declinedBySelf: boolean;
      selfRsvp: string | null;
      selfResponseStatus: string | null;
      canRsvp: boolean;
      accountId: string;
      recurringEventId: string | null;
      isRecurring: boolean;
    }[] = [];

    await Promise.allSettled(
      selectedCals.map(async (calInfo) => {
        try {
          const client = await resolveClientForCalendar(s.accounts, calInfo.id);
          if (!client) {
            loadErrors.push(`No API client for "${calInfo.summary}".`);
            return;
          }
          const items = await listAllEvents(client, calInfo.id, timeMin, timeMax);
          const visible = items.filter(
            (ev) =>
              ev.status !== "cancelled" &&
              ev.transparency !== "transparent" &&
              !ev.extendedProperties?.private?.[CALSYNC_SOURCE_KEY]
          );
          for (const ev of visible) {
            const attendees = ev.attendees ?? [];
            const hasSelfAttendee = attendees.some(
              (a) =>
                a.self === true ||
                (typeof a.email === "string" &&
                  linkedAccountEmails.has(a.email.trim().toLowerCase()))
            );
            const canRsvp = hasSelfAttendee || userOwnsEvent(ev, linkedAccountEmails);
            const selfResponseStatus = selfResponseStatusForAccount(
              ev,
              linkedAccountEmails
            );
            const selfRsvp = getSelfRsvp(ev);
            rows.push({
              calendarId: calInfo.id,
              calendarSummary: calInfo.summary,
              accountEmail: calInfo.accountEmail,
              id: ev.id ?? null,
              summary: ev.summary ?? null,
              start: ev.start ?? null,
              end: ev.end ?? null,
              htmlLink: ev.htmlLink ?? null,
              transparency: ev.transparency ?? null,
              meetingUrl: meetingUrlFromEvent(ev),
              declinedBySelf: selfResponseStatus === "declined",
              selfRsvp,
              selfResponseStatus,
              canRsvp,
              accountId: calInfo.accountId,
              recurringEventId: ev.recurringEventId ?? null,
              isRecurring: !!(ev.recurringEventId || (ev.recurrence && ev.recurrence.length > 0)),
            });
          }
        } catch (e) {
          if (isInvalidGrant(e)) {
            const label = calInfo.accountEmail ?? calInfo.accountId;
            if (!staleAccounts.includes(label)) staleAccounts.push(label);
          } else {
            const msg = e instanceof Error ? e.message : String(e);
            loadErrors.push(`"${calInfo.summary}": ${msg}`);
          }
        }
      })
    );

    rows.sort((a, b) => {
      const ka = rowStartMs(a.start);
      const kb = rowStartMs(b.start);
      if (ka !== kb) return ka - kb;
      return (a.summary ?? "").localeCompare(b.summary ?? "");
    });

    // Deduplicate: same invite can appear in multiple source calendars (e.g. same event on two accounts)
    const dedupMap = new Map<string, (typeof rows)[0]>();
    const noIdRows: typeof rows = [];
    for (const row of rows) {
      if (!row.id) { noIdRows.push(row); continue; }
      const existing = dedupMap.get(row.id);
      if (!existing) {
        dedupMap.set(row.id, row);
      } else if (!existing.selfRsvp && row.selfRsvp) {
        dedupMap.set(row.id, row);
      }
    }
    const dedupedRows = [...dedupMap.values(), ...noIdRows];
    dedupedRows.sort((a, b) => {
      const ka = rowStartMs(a.start);
      const kb = rowStartMs(b.start);
      if (ka !== kb) return ka - kb;
      return (a.summary ?? "").localeCompare(b.summary ?? "");
    });

    return NextResponse.json({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      ...(legacyDays !== undefined ? { days: legacyDays } : {}),
      events: dedupedRows,
      loadErrors,
      staleAccounts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: "google_api",
        message: msg,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        ...(legacyDays !== undefined ? { days: legacyDays } : {}),
        events: [],
        loadErrors: [msg],
      },
      { status: 502 }
    );
  }
}
