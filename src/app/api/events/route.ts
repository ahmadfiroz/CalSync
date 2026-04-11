import { NextRequest, NextResponse } from "next/server";
import type { calendar_v3 } from "@googleapis/calendar";
import { isStoreConnected } from "@/lib/store";
import { readStoreForUser } from "@/lib/store-db";
import { resolveClientForCalendar } from "@/lib/accounts";
import { CALSYNC_SOURCE_KEY } from "@/lib/constants";
import { isEventDeclinedBySelf, listAllEvents } from "@/lib/sync";
import { listCalendarsMerged } from "@/lib/calendar-directory";
import { requireUserId } from "@/lib/api-session";

export const runtime = "nodejs";

const MAX_RANGE_DAYS = 90;

const HTTPS_URL_IN_TEXT = /https?:\/\/[^\s<>\]"')]+/g;

function trimTrailingUrlJunk(s: string): string {
  return s.replace(/[.,;:)]+$/, "");
}

function isPreferredMeetingHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "zoom.us" ||
    h.endsWith(".zoom.us") ||
    h.includes("meet.google") ||
    h.includes("teams.microsoft") ||
    h.includes("webex.com")
  );
}

/** Zoom and other non–Google Meet links are often only in `location`, not conferenceData. */
function meetingUrlFromLocation(
  location: string | null | undefined
): string | null {
  if (!location?.trim()) return null;
  const matches = location.match(HTTPS_URL_IN_TEXT);
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

function meetingUrlFromEvent(ev: calendar_v3.Schema$Event): string | null {
  if (ev.hangoutLink) return ev.hangoutLink;
  const eps = ev.conferenceData?.entryPoints;
  if (eps?.length) {
    const video = eps.find((e) => e.entryPointType === "video");
    if (video?.uri) return video.uri;
    const any = eps.find((e) => e.uri);
    if (any?.uri) return any.uri;
  }
  return meetingUrlFromLocation(ev.location);
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

export async function GET(req: NextRequest) {
  let days = Number(req.nextUrl.searchParams.get("days") ?? "7");
  if (!Number.isFinite(days) || days < 1) days = 7;
  days = Math.min(Math.floor(days), MAX_RANGE_DAYS);

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
      return NextResponse.json({ days, events: [], loadErrors: [], staleAccounts: [] });
    }

    // Show events from all source calendars across all mirror rules
    const sourceCalIds = new Set(
      (s.mirrorRules ?? []).flatMap((r) => r.sourceCals)
    );
    const selectedCals = dir.calendars.filter((c) => sourceCalIds.has(c.id));
    if (!selectedCals.length) {
      return NextResponse.json({ days, events: [], loadErrors: [], staleAccounts: dir.staleAccounts });
    }

    const timeMin = new Date();
    const timeMax = new Date(timeMin);
    timeMax.setDate(timeMax.getDate() + days);

    const loadErrors: string[] = [];
    // Start with accounts already detected stale by listCalendarsMerged
    const staleAccounts: string[] = [...dir.staleAccounts];
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
              declinedBySelf: isEventDeclinedBySelf(ev),
              selfRsvp: getSelfRsvp(ev),
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

    return NextResponse.json({
      days,
      events: rows,
      loadErrors,
      staleAccounts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: "google_api",
        message: msg,
        days,
        events: [],
        loadErrors: [msg],
      },
      { status: 502 }
    );
  }
}
