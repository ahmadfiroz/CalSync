import { getCalendarClient } from "./google";
import type { CalSyncStore } from "./store";
import { isStoreConnected } from "./store";

export type ListedCal = {
  id: string;
  summary: string;
  primary?: boolean;
  accountId: string;
  accountEmail: string | null;
};

export type CalendarDirectory = {
  calendars: ListedCal[];
  /** Emails of accounts whose refresh token is expired/revoked. */
  staleAccounts: string[];
};

/** Union of calendarList across accounts (first wins for metadata). Per-account errors are caught. */
export async function listCalendarsMerged(
  s: CalSyncStore | null
): Promise<CalendarDirectory | null> {
  if (!s || !isStoreConnected(s)) return null;
  const byId = new Map<string, ListedCal>();
  const staleAccounts: string[] = [];

  for (const acc of s.accounts) {
    try {
      const cal = getCalendarClient(acc.refreshToken);
      let pageToken: string | undefined;
      do {
        const res = await cal.calendarList.list({
          maxResults: 250,
          pageToken,
          showHidden: false,
        });
        for (const c of res.data.items ?? []) {
          if (!c.id) continue;
          if (!byId.has(c.id)) {
            byId.set(c.id, {
              id: c.id,
              summary: c.summary || c.id,
              primary: Boolean(c.primary),
              accountId: acc.id,
              accountEmail: acc.email ?? null,
            });
          }
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const label = acc.email ?? acc.id;
      if (msg.toLowerCase().includes("invalid_grant")) {
        staleAccounts.push(label);
      } else {
        console.error(`[CalSync] calendarList.list failed for ${label}:`, msg);
      }
    }
  }

  const calendars = Array.from(byId.values());
  calendars.sort((a, b) => a.summary.localeCompare(b.summary));
  return { calendars, staleAccounts };
}
