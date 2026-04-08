import type { calendar_v3 } from "@googleapis/calendar";
import type { ConnectedAccount } from "./store";
import { getCalendarClient } from "./google";

/** Calendars the given accounts can access (union of calendarList). */
export async function listAllowedCalendarIds(
  accounts: ConnectedAccount[]
): Promise<Set<string>> {
  const allowed = new Set<string>();
  for (const acc of accounts) {
    try {
      const cal = getCalendarClient(acc.refreshToken);
      let pageToken: string | undefined;
      do {
        const res = await cal.calendarList.list({
          maxResults: 250,
          pageToken,
        });
        for (const c of res.data.items ?? []) {
          if (c.id) allowed.add(c.id);
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    } catch (e) {
      const label = acc.email ?? acc.id;
      console.error(
        `[CalSync] calendarList.list failed for account ${label}:`,
        e instanceof Error ? e.message : e
      );
    }
  }
  return allowed;
}

export function pruneSyncCalendarIds(
  syncCalendarIds: string[],
  allowed: Set<string>
): string[] {
  return syncCalendarIds.filter((id) => allowed.has(id));
}

/** Lower rank = preferred for API calls that create/update events. */
const ACCESS_RANK: Record<string, number> = {
  owner: 0,
  writer: 1,
  reader: 2,
  freeBusyReader: 3,
};

/**
 * Picks the Google account whose calendar list entry has the strongest access.
 * Preferring writer/owner avoids using a read-only subscription when another
 * linked account can edit the same calendar (fixes "need writer access").
 */
export async function resolveClientForCalendar(
  accounts: ConnectedAccount[],
  calendarId: string
): Promise<calendar_v3.Calendar | null> {
  type Cand = { cal: calendar_v3.Calendar; rank: number };
  const cands: Cand[] = [];

  for (const acc of accounts) {
    const cal = getCalendarClient(acc.refreshToken);
    try {
      const entry = await cal.calendarList.get({ calendarId });
      const role = entry.data.accessRole ?? "reader";
      const rank = ACCESS_RANK[role] ?? 9;
      cands.push({ cal, rank });
    } catch {
      try {
        await cal.calendars.get({ calendarId });
        cands.push({ cal, rank: ACCESS_RANK.reader });
      } catch {
        continue;
      }
    }
  }

  if (!cands.length) return null;
  cands.sort((a, b) => a.rank - b.rank);
  return cands[0]!.cal;
}

export async function buildClientMapForCalendars(
  accounts: ConnectedAccount[],
  calendarIds: string[]
): Promise<Map<string, calendar_v3.Calendar>> {
  const map = new Map<string, calendar_v3.Calendar>();
  for (const id of calendarIds) {
    const client = await resolveClientForCalendar(accounts, id);
    if (client) map.set(id, client);
  }
  return map;
}
