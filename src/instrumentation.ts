export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const g = globalThis as typeof globalThis & { __calsyncInstrumentation?: boolean };
  if (g.__calsyncInstrumentation) return;
  g.__calsyncInstrumentation = true;

  const sec = Number(process.env.CALSYNC_AUTO_SYNC_INTERVAL_SEC);
  if (Number.isFinite(sec) && sec >= 30) {
    const { performFullSyncCoalescedForUser } = await import(
      "./lib/run-sync-from-store"
    );
    const { listUserIds } = await import("./lib/store-db");
    setInterval(() => {
      void (async () => {
        try {
          const ids = await listUserIds();
          for (const userId of ids) {
            void performFullSyncCoalescedForUser(userId);
          }
        } catch {
          /* missing Supabase env, etc. */
        }
      })();
    }, sec * 1000);
  }

  const hour = 60 * 60 * 1000;
  const { readStoreForUser, writeStoreForUser, listUserIds } = await import(
    "./lib/store-db"
  );
  const { renewExpiringWatches, calendarPushAvailable } = await import(
    "./lib/calendar-watch"
  );
  const { isStoreConnected } = await import("./lib/store");

  setInterval(() => {
    void (async () => {
      try {
        if (!calendarPushAvailable()) return;
        const ids = await listUserIds();
        for (const userId of ids) {
          const s = await readStoreForUser(userId);
          if (!isStoreConnected(s)) continue;
          const calIds = s.syncCalendarIds ?? [];
          if (calIds.length < 2) continue;
          const next = await renewExpiringWatches(
            s.accounts,
            calIds,
            s.calendarWatchChannels
          );
          if (next === null) continue;
          await writeStoreForUser(userId, {
            ...s,
            calendarWatchChannels: next.length ? next : undefined,
          });
        }
      } catch {
        /* noop */
      }
    })();
  }, hour);
}
