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

    const directory = await listCalendarsMerged(s);
    if (!directory?.length) {
      return NextResponse.json({ days, events: [], loadErrors: [] });
    }

    const syncSet = new Set(s.syncCalendarIds ?? []);
    const selectedCals = directory.filter((c) => syncSet.has(c.id));
    if (!selectedCals.length) {
      return NextResponse.json({ days, events: [], loadErrors: [] });
    }

    const timeMin = new Date();
    const timeMax = new Date(timeMin);
    timeMax.setDate(timeMax.getDate() + days);

    const loadErrors: string[] = [];
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
    }[] = [];

    const settled = await Promise.allSettled(
      selectedCals.map(async (calInfo) => {
        const client = await resolveClientForCalendar(s.accounts, calInfo.id);
        if (!client) {
          loadErrors.push(
            `No API client for “${calInfo.summary}” (${calInfo.id}).`
          );
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
          });
        }
      })
    );

    for (const r of settled) {
      if (r.status === "rejected") {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        loadErrors.push(msg);
      }
    }

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
