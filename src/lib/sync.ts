import type { calendar_v3 } from "@googleapis/calendar";
import { CALSYNC_SOURCE_KEY, SYNC_WINDOW_DAYS } from "./constants";

export type SyncResult = {
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
  /** Total event rows returned from Google for calendars in the sync group (includes mirrors). */
  eventsListed?: number;
  /** Source-side events not used as busy blocks (helps explain 0 created/updated). */
  skipped?: {
    cancelledOrNoId: number;
    calSyncMirror: number;
    notBusy: number;
    declinedByYou: number;
    missingStartOrEnd: number;
  };
};

/** True when this calendar copy is an invitation you declined (RSVP). */
export function isEventDeclinedBySelf(ev: calendar_v3.Schema$Event): boolean {
  const attendees = ev.attendees;
  if (!attendees?.length) return false;
  return attendees.some(
    (a) => a.self === true && a.responseStatus === "declined"
  );
}

function classifySkip(
  ev: calendar_v3.Schema$Event
): keyof NonNullable<SyncResult["skipped"]> | null {
  if (!ev.id || ev.status === "cancelled") return "cancelledOrNoId";
  if (ev.extendedProperties?.private?.[CALSYNC_SOURCE_KEY]) return "calSyncMirror";
  if (ev.transparency === "transparent") return "notBusy";
  if (isEventDeclinedBySelf(ev)) return "declinedByYou";
  return null;
}

function sourceKey(calendarId: string, eventId: string) {
  return `${calendarId}|${eventId}`;
}

function parseMirrorKey(
  ev: calendar_v3.Schema$Event
): string | null {
  const v = ev.extendedProperties?.private?.[CALSYNC_SOURCE_KEY];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function listAllEvents(
  cal: calendar_v3.Calendar,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<calendar_v3.Schema$Event[]> {
  const out: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  do {
    const res = await cal.events.list({
      calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      pageToken,
    });
    const items = res.data.items ?? [];
    out.push(...items);
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

const CLEAR_MIRRORS_PAST_DAYS = 365 * 5;

/**
 * Deletes every CalSync mirror block on a calendar (events with private
 * `calsyncSource`). Uses a wide time range so past mirrors are included
 * (normal sync only lists from now onward).
 */
export async function clearMirrorsOnCalendar(
  cal: calendar_v3.Calendar,
  calendarId: string
): Promise<{ deleted: number; errors: string[] }> {
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - CLEAR_MIRRORS_PAST_DAYS);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + SYNC_WINDOW_DAYS);

  const errors: string[] = [];
  let items: calendar_v3.Schema$Event[];
  try {
    items = await listAllEvents(cal, calendarId, timeMin, timeMax);
  } catch (e) {
    return {
      deleted: 0,
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }

  let deleted = 0;
  for (const ev of items) {
    const mk = parseMirrorKey(ev);
    if (!mk || !ev.id) continue;
    try {
      await cal.events.delete({ calendarId, eventId: ev.id });
      deleted += 1;
    } catch (e) {
      errors.push(
        `Delete mirror ${ev.id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return { deleted, errors };
}

type BlockSpec = {
  key: string;
  summary: string;
  start: calendar_v3.Schema$EventDateTime;
  end: calendar_v3.Schema$EventDateTime;
};

function toBlockSpec(
  sourceCalendarId: string,
  ev: calendar_v3.Schema$Event,
  sourceLabel: string
): BlockSpec | null {
  if (!ev.start || !ev.end) return null;
  const key = sourceKey(sourceCalendarId, ev.id!);
  const summary = ev.summary?.trim()
    ? `Busy (${ev.summary.trim()})`
    : `Busy (${sourceLabel})`;
  return { key, summary, start: ev.start, end: ev.end };
}

/** Directed mirror sync: each rule reads from sourceCals and writes to destCalId. */
export async function runDirectedMirrorSync(
  clientFor: (calendarId: string) => calendar_v3.Calendar | undefined,
  rules: Array<{ sourceCals: string[]; destCalId: string }>,
  labels: Record<string, string>
): Promise<SyncResult> {
  const result: SyncResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    errors: [],
    skipped: {
      cancelledOrNoId: 0,
      calSyncMirror: 0,
      notBusy: 0,
      declinedByYou: 0,
      missingStartOrEnd: 0,
    },
  };

  if (rules.length === 0) {
    result.errors.push("No mirror rules configured.");
    delete result.skipped;
    return result;
  }

  const now = new Date();
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + SYNC_WINDOW_DAYS);

  // Collect all unique calendar IDs
  const allIds = new Set<string>();
  for (const r of rules) {
    for (const s of r.sourceCals) allIds.add(s);
    allIds.add(r.destCalId);
  }

  const byCal: Record<string, calendar_v3.Schema$Event[]> = {};
  for (const id of allIds) {
    const cal = clientFor(id);
    if (!cal) {
      result.errors.push(`No Google account linked for calendar ${id}.`);
      continue;
    }
    try {
      byCal[id] = await listAllEvents(cal, id, now, timeMax);
    } catch (e) {
      result.errors.push(
        `List failed for ${id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  result.eventsListed = Object.values(byCal).reduce(
    (sum, evs) => sum + evs.length,
    0
  );

  // Build desired blocks per destination calendar
  const desiredByTarget: Record<string, Map<string, BlockSpec>> = {};
  for (const rule of rules) {
    if (!desiredByTarget[rule.destCalId]) {
      desiredByTarget[rule.destCalId] = new Map();
    }
    const dest = desiredByTarget[rule.destCalId]!;
    for (const sourceId of rule.sourceCals) {
      const label = labels[sourceId] || sourceId;
      for (const ev of byCal[sourceId] ?? []) {
        const skipKind = classifySkip(ev);
        if (skipKind) {
          result.skipped![skipKind] += 1;
          continue;
        }
        const spec = toBlockSpec(sourceId, ev, label);
        if (!spec) {
          result.skipped!.missingStartOrEnd += 1;
          continue;
        }
        dest.set(spec.key, spec);
      }
    }
  }

  // Reconcile each destination calendar
  for (const [targetId, desired] of Object.entries(desiredByTarget)) {
    const targetCal = clientFor(targetId);
    if (!targetCal) {
      result.errors.push(`No Google account linked for calendar ${targetId}.`);
      continue;
    }
    const existing = byCal[targetId] ?? [];
    const mirrors = new Map<string, calendar_v3.Schema$Event>();
    const duplicateMirrorEvents: calendar_v3.Schema$Event[] = [];
    for (const ev of existing) {
      const mk = parseMirrorKey(ev);
      if (!mk || !ev.id) continue;
      if (mirrors.has(mk)) {
        duplicateMirrorEvents.push(ev);
      } else {
        mirrors.set(mk, ev);
      }
    }

    for (const ev of duplicateMirrorEvents) {
      try {
        await targetCal.events.delete({ calendarId: targetId, eventId: ev.id! });
        result.deleted += 1;
      } catch (e) {
        result.errors.push(
          `Delete duplicate mirror on ${targetId}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    for (const [key, mirrorEv] of mirrors) {
      if (!desired.has(key)) {
        try {
          await targetCal.events.delete({
            calendarId: targetId,
            eventId: mirrorEv.id!,
          });
          result.deleted += 1;
        } catch (e) {
          result.errors.push(
            `Delete mirror on ${targetId}: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    }

    for (const [key, spec] of desired) {
      const existingMirror = mirrors.get(key);
      const body: calendar_v3.Schema$Event = {
        summary: spec.summary,
        description: "Blocked by CalSync to mirror another calendar.",
        start: spec.start,
        end: spec.end,
        transparency: "opaque",
        extendedProperties: {
          private: { [CALSYNC_SOURCE_KEY]: key },
        },
      };

      if (!existingMirror) {
        try {
          await targetCal.events.insert({ calendarId: targetId, requestBody: body });
          result.created += 1;
        } catch (e) {
          result.errors.push(
            `Create mirror on ${targetId}: ${e instanceof Error ? e.message : String(e)}`
          );
        }
        continue;
      }

      const same =
        existingMirror.summary === body.summary &&
        JSON.stringify(existingMirror.start) === JSON.stringify(body.start) &&
        JSON.stringify(existingMirror.end) === JSON.stringify(body.end);
      if (same) continue;

      try {
        await targetCal.events.patch({
          calendarId: targetId,
          eventId: existingMirror.id!,
          requestBody: body,
        });
        result.updated += 1;
      } catch (e) {
        result.errors.push(
          `Update mirror on ${targetId}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  const sk = result.skipped!;
  if (
    sk.cancelledOrNoId === 0 &&
    sk.calSyncMirror === 0 &&
    sk.notBusy === 0 &&
    sk.declinedByYou === 0 &&
    sk.missingStartOrEnd === 0
  ) {
    delete result.skipped;
  }

  return result;
}

