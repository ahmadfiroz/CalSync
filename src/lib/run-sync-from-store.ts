import type { SyncResult } from "./sync";
import { runMirrorSync } from "./sync";
import { buildClientMapForCalendars } from "./accounts";
import { isStoreConnected } from "./store";
import { readStoreForUser } from "./store-db";

const syncInFlight = new Map<string, Promise<SyncResult | null>>();

export async function performFullSyncForUser(
  userId: string
): Promise<SyncResult | null> {
  const s = await readStoreForUser(userId);
  if (!isStoreConnected(s)) return null;
  const ids = s.syncCalendarIds ?? [];
  if (ids.length < 2) return null;

  const clientMap = await buildClientMapForCalendars(s.accounts, ids);
  const clientFor = (calendarId: string) => clientMap.get(calendarId);

  const labels: Record<string, string> = {};
  for (const id of ids) {
    const cal = clientFor(id);
    if (!cal) {
      labels[id] = id;
      continue;
    }
    try {
      const meta = await cal.calendars.get({ calendarId: id });
      labels[id] = meta.data.summary || id;
    } catch {
      labels[id] = id;
    }
  }

  return runMirrorSync(clientFor, ids, labels);
}

/** Single-flight per user: concurrent triggers coalesce to one run. */
export function performFullSyncCoalescedForUser(
  userId: string
): Promise<SyncResult | null> {
  const existing = syncInFlight.get(userId);
  if (existing) return existing;
  const p = performFullSyncForUser(userId).finally(() => {
    syncInFlight.delete(userId);
  });
  syncInFlight.set(userId, p);
  return p;
}
