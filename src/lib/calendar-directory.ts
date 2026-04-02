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

/** Union of calendarList across accounts (first wins for metadata). */
export async function listCalendarsMerged(
  s: CalSyncStore | null
): Promise<ListedCal[] | null> {
  if (!s || !isStoreConnected(s)) return null;
  const byId = new Map<string, ListedCal>();
  for (const acc of s.accounts) {
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
  }
  const items = Array.from(byId.values());
  items.sort((a, b) => a.summary.localeCompare(b.summary));
  return items;
}
