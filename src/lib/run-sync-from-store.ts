import type { SyncResult } from "./sync";
import { runMirrorSync } from "./sync";
import { buildClientMapForCalendars } from "./accounts";
import { isStoreConnected } from "./store";
import { readStoreForUser } from "./store-db";

type InFlightSync = {
  startedAtMs: number;
  promise: Promise<SyncResult | null>;
};

const syncInFlight = new Map<string, InFlightSync>();

const DEFAULT_COALESCE_TIMEOUT_MS = 5 * 60 * 1000;
const STALE_LOCK_BUFFER_MS = 15 * 1000;

function coalesceTimeoutMs(): number {
  const sec = Number(process.env.CALSYNC_SYNC_COALESCE_TIMEOUT_SEC);
  if (!Number.isFinite(sec) || sec < 10) return DEFAULT_COALESCE_TIMEOUT_MS;
  return Math.floor(sec * 1000);
}

async function withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`sync timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  const now = Date.now();
  const timeoutMs = coalesceTimeoutMs();
  const existing = syncInFlight.get(userId);

  if (existing) {
    const ageMs = now - existing.startedAtMs;
    if (ageMs < timeoutMs + STALE_LOCK_BUFFER_MS) {
      return existing.promise;
    }
    // Recover from a stale in-memory lock so future auto-sync triggers can run.
    syncInFlight.delete(userId);
  }

  const p = withTimeout(performFullSyncForUser(userId), timeoutMs)
    .catch(() => null)
    .finally(() => {
      syncInFlight.delete(userId);
    });
  syncInFlight.set(userId, { startedAtMs: now, promise: p });
  return p;
}
