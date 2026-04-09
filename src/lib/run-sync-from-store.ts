import type { calendar_v3 } from "googleapis";
import type { SyncResult } from "./sync";
import { runDirectedMirrorSync } from "./sync";
import { getClientForAccount, getOrCreateCalSyncCalendar } from "./accounts";
import { readStore, writeStore, isStoreConnected } from "./store";

let syncInFlight: Promise<SyncResult | null> | null = null;

export async function performFullSync(): Promise<SyncResult | null> {
  const s = readStore();
  if (!isStoreConnected(s)) return null;

  const rules = s.mirrorRules ?? [];
  if (rules.length === 0) return null;

  // Resolve __auto__ destCalIds to real calendar IDs and persist them back to
  // the store so we don't do a calendarList + possible calendar.insert on every sync.
  let storeNeedsUpdate = false;
  const updatedRules = [...rules];

  for (let i = 0; i < updatedRules.length; i++) {
    const rule = updatedRules[i]!;
    if (rule.destCalId !== "__auto__") continue;

    const resolved = await getOrCreateCalSyncCalendar(s.accounts, rule.destAccountId);
    if (!resolved) {
      console.error(
        `[CalSync] Could not find/create CalSync calendar for account ${rule.destAccountId}`
      );
      continue;
    }
    updatedRules[i] = { ...rule, destCalId: resolved };
    storeNeedsUpdate = true;
  }

  if (storeNeedsUpdate) {
    writeStore({ ...s, mirrorRules: updatedRules });
  }

  // Build directed sync inputs using the account we know owns each calendar.
  // This avoids the N-account calendarList.get probe inside resolveClientForCalendar.
  type DirectedRule = { sourceCals: string[]; destCalId: string };
  const syncRules: DirectedRule[] = [];

  const clientMap = new Map<string, calendar_v3.Calendar>();

  for (const rule of updatedRules) {
    if (rule.sourceCals.length === 0 || rule.destCalId === "__auto__") continue;

    const srcClient = getClientForAccount(s.accounts, rule.sourceAccountId);
    const dstClient = getClientForAccount(s.accounts, rule.destAccountId);

    if (!srcClient || !dstClient) {
      console.error(
        `[CalSync] Missing client for rule ${rule.id} ` +
          `(src: ${rule.sourceAccountId}, dst: ${rule.destAccountId})`
      );
      continue;
    }

    for (const calId of rule.sourceCals) {
      clientMap.set(calId, srcClient);
    }
    clientMap.set(rule.destCalId, dstClient);

    syncRules.push({ sourceCals: rule.sourceCals, destCalId: rule.destCalId });
  }

  if (syncRules.length === 0) return null;

  const clientFor = (calendarId: string) => clientMap.get(calendarId);

  // Fetch display names for mirror event summaries ("Busy (Calendar Name)")
  const labels: Record<string, string> = {};
  const allCalIds = new Set<string>(syncRules.flatMap((r) => [...r.sourceCals, r.destCalId]));
  await Promise.allSettled(
    Array.from(allCalIds).map(async (id) => {
      const cal = clientFor(id);
      if (!cal) return;
      try {
        const meta = await cal.calendars.get({ calendarId: id });
        labels[id] = meta.data.summary || id;
      } catch {
        labels[id] = id;
      }
    })
  );

  return runDirectedMirrorSync(clientFor, syncRules, labels);
}

/** Single-flight: concurrent triggers coalesce to one run. */
export function performFullSyncCoalesced(): Promise<SyncResult | null> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = performFullSync().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}
