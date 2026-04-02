"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Account = { id: string; email: string | null };

type Me = {
  connected: boolean;
  accounts?: Account[];
  email?: string | null;
  syncCalendarIds?: string[];
};

type Cal = {
  id: string;
  summary: string;
  primary?: boolean;
  accountId: string;
  accountEmail: string | null;
};

type ListedEvent = {
  calendarId: string;
  calendarSummary: string;
  accountEmail: string | null;
  id: string | null;
  summary: string | null;
  start: { dateTime?: string | null; date?: string | null } | null;
  end: { dateTime?: string | null; date?: string | null } | null;
  htmlLink: string | null;
  transparency: string | null;
  meetingUrl: string | null;
};

function startOfLocalDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function parseGCalDate(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00`);
}

/** Matches Google Calendar all-day end (exclusive): one day if end = start + 1 day. */
function formatEventSchedule(ev: ListedEvent): string {
  const s = ev.start;
  const e = ev.end;
  if (!s) return "—";

  if (s.date && !s.dateTime) {
    const sd = s.date;
    const ed = e?.date;
    if (!ed) {
      return parseGCalDate(sd).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }
    const sdt = parseGCalDate(sd);
    const edt = parseGCalDate(ed);
    const dayMs = 86_400_000;
    const span = edt.getTime() - sdt.getTime();
    if (span <= dayMs) {
      return sdt.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }
    const endInclusive = new Date(edt);
    endInclusive.setDate(endInclusive.getDate() - 1);
    return `${sdt.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${endInclusive.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }

  if (!s.dateTime) return "—";
  const start = new Date(s.dateTime);
  if (Number.isNaN(start.getTime())) return "—";
  const end = e?.dateTime ? new Date(e.dateTime) : null;
  if (!end || Number.isNaN(end.getTime())) {
    return start.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const now = new Date();
  const today0 = startOfLocalDay(now);
  const tomorrow0 = today0 + 86_400_000;
  const start0 = startOfLocalDay(start);

  let datePrefix: string;
  if (start0 === today0) datePrefix = "Today";
  else if (start0 === tomorrow0) datePrefix = "Tomorrow";
  else {
    datePrefix = start.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  const sameDay = startOfLocalDay(start) === startOfLocalDay(end);
  const tfmt: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  const a = start.toLocaleTimeString(undefined, tfmt);
  const b = end.toLocaleTimeString(undefined, tfmt);

  if (sameDay) {
    if (datePrefix === "Today" || datePrefix === "Tomorrow") {
      return `${datePrefix} ${a}–${b}`;
    }
    return `${datePrefix} • ${a}–${b}`;
  }

  return `${start.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} – ${end.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

export default function Home() {
  const [urlError, setUrlError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [calendars, setCalendars] = useState<Cal[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [lastSync, setLastSync] = useState<{
    created: number;
    updated: number;
    deleted: number;
    errors: string[];
    eventsListed?: number;
    skipped?: {
      cancelledOrNoId: number;
      calSyncMirror: number;
      notBusy: number;
      missingStartOrEnd: number;
    };
  } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [addCalendarId, setAddCalendarId] = useState("");
  const [addBusy, setAddBusy] = useState<"create" | "add" | null>(null);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [calendarOwnerAccountId, setCalendarOwnerAccountId] = useState("");
  const [dashTab, setDashTab] = useState<"sync" | "events">("events");
  const [eventsDays, setEventsDays] = useState(30);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsErr, setEventsErr] = useState<string | null>(null);
  const [eventsRows, setEventsRows] = useState<ListedEvent[]>([]);
  const [eventsLoadWarnings, setEventsLoadWarnings] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoadErr(null);
    try {
      const r = await fetch("/api/me");
      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }
      const m = (await r.json()) as Me;
      setMe(m);
      if (!m.connected) {
        setCalendars([]);
        setSelected(new Set());
        setCalendarOwnerAccountId("");
        return;
      }
      const cr = await fetch("/api/calendars");
      if (!cr.ok) throw new Error("Could not load calendars");
      const cj = (await cr.json()) as { calendars: Cal[] };
      setCalendars(cj.calendars);
      const ids = m.syncCalendarIds ?? [];
      const known = new Set(cj.calendars.map((c) => c.id));
      const fromServer = ids.filter((id) => known.has(id));
      if (fromServer.length) {
        setSelected(new Set(fromServer));
      } else {
        const primaries = cj.calendars.filter((c) => c.primary).map((c) => c.id);
        setSelected(new Set(primaries));
      }
      const acctIds = m.accounts?.map((a) => a.id) ?? [];
      setCalendarOwnerAccountId((cur) =>
        cur && acctIds.includes(cur) ? cur : acctIds[0] ?? ""
      );
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const e = p.get("error");
    if (e) setUrlError(e);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const savedSyncGroupKey = useMemo(
    () => (me?.syncCalendarIds ?? []).join("\0"),
    [me?.syncCalendarIds]
  );

  useEffect(() => {
    if (dashTab !== "events" || !me?.connected) return;
    let cancelled = false;
    setEventsLoading(true);
    setEventsErr(null);
    setEventsLoadWarnings([]);
    void (async () => {
      try {
        const r = await fetch(`/api/events?days=${eventsDays}`);
        const j = (await r.json()) as {
          events?: ListedEvent[];
          loadErrors?: string[];
          error?: string;
          message?: string;
        };
        if (cancelled) return;
        if (!r.ok) {
          throw new Error(j.message || j.error || r.statusText);
        }
        setEventsRows(j.events ?? []);
        setEventsLoadWarnings(j.loadErrors ?? []);
      } catch (e) {
        if (!cancelled) {
          setEventsErr(e instanceof Error ? e.message : String(e));
          setEventsRows([]);
          setEventsLoadWarnings([]);
        }
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dashTab, eventsDays, me?.connected, savedSyncGroupKey]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const saveConfig = async () => {
    setSaveBusy(true);
    setLastSync(null);
    try {
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncCalendarIds: Array.from(selected) }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || r.statusText);
      }
      await refresh();
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    setLastSync(null);
    try {
      const r = await fetch("/api/sync", { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        throw new Error(
          (j as { message?: string }).message ||
            (j as { error?: string }).error ||
            "Sync failed"
        );
      }
      setLastSync(j as typeof lastSync);
    } catch (e) {
      setLastSync({
        created: 0,
        updated: 0,
        deleted: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      });
    } finally {
      setSyncing(false);
    }
  };

  const logoutAll = async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const signOutDashboard = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/login";
  };

  const disconnectAccount = async (accountId: string) => {
    await fetch("/api/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    setLoading(true);
    await refresh();
  };

  const postCalendar = async (
    action: "create" | "add",
    payload: Record<string, string>
  ) => {
    const accountId = calendarOwnerAccountId || me?.accounts?.[0]?.id;
    if (!accountId) {
      setAddErr("No Google account selected.");
      return;
    }
    setAddErr(null);
    setAddBusy(action);
    try {
      const r = await fetch("/api/calendars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, accountId, ...payload }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        calendar?: { id: string };
        error?: string;
        message?: string;
      };
      if (!r.ok) {
        throw new Error(j.message || j.error || r.statusText);
      }
      const newId = j.calendar?.id;
      setCreateName("");
      setAddCalendarId("");
      await refresh();
      if (newId) {
        setSelected((prev) => new Set(prev).add(newId));
      }
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAddBusy(null);
    }
  };

  const displayError = useMemo(
    () => urlError || loadErr,
    [urlError, loadErr]
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            CalSync
          </h1>
          {!loading ? (
            <button
              type="button"
              onClick={() => void signOutDashboard()}
              className="shrink-0 text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
            >
              Sign out
            </button>
          ) : null}
        </div>
        <p className="text-sm leading-relaxed text-zinc-400">
          Connect the Google calendars you use. When you are busy on one,
          CalSync adds matching &ldquo;Busy&rdquo; blocks on the others for the
          next {90} days. Mirrored blocks are tagged so they are not copied
          back.
        </p>
      </header>

      {displayError ? (
        <div
          className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {displayError}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : !me?.connected ? (
        <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <p className="text-sm text-zinc-300">
            Sign in with Google and grant calendar access. Your refresh token is
            stored only in <code className="text-zinc-100">.data/store.json</code>{" "}
            on this machine (add <code className="text-zinc-100">.data/</code> to
            backups if you move computers).
          </p>
          <a
            href="/api/auth/google"
            className="inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
          >
            Connect Google Calendar
          </a>
        </div>
      ) : (
        <div className="space-y-6">
          <div
            className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950/50 p-1"
            role="tablist"
            aria-label="Dashboard sections"
          >
            <button
              type="button"
              role="tab"
              aria-selected={dashTab === "events"}
              onClick={() => setDashTab("events")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                dashTab === "events"
                  ? "bg-zinc-800 text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Upcoming events
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={dashTab === "sync"}
              onClick={() => setDashTab("sync")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                dashTab === "sync"
                  ? "bg-zinc-800 text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Sync setup
            </button>
          </div>

          {dashTab === "events" ? (
            <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <div className="space-y-1">
                <h2 className="text-sm font-medium text-zinc-200">
                  Upcoming events (sync group)
                </h2>
                <p className="text-xs text-zinc-500">
                  Only calendars you have checked under &ldquo;Calendars in sync
                  group&rdquo; and saved. Sorted by start time. Meet links come
                  from Google when the event has conferencing.
                </p>
              </div>
              <label className="inline-flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-400">
                  Time range
                </span>
                <select
                  value={eventsDays}
                  onChange={(e) => setEventsDays(Number(e.target.value))}
                  className="w-fit rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                >
                  <option value={7}>Next 7 days</option>
                  <option value={30}>Next 30 days</option>
                  <option value={90}>Next 90 days</option>
                </select>
              </label>
              {eventsErr ? (
                <p
                  className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-200"
                  role="alert"
                >
                  {eventsErr}
                </p>
              ) : null}
              {eventsLoadWarnings.length > 0 ? (
                <ul
                  className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/90"
                  role="status"
                >
                  {eventsLoadWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : null}
              {eventsLoading ? (
                <p className="text-sm text-zinc-500">Loading events…</p>
              ) : eventsRows.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  {savedSyncGroupKey === ""
                    ? "No calendars in your saved sync group. Open Sync setup, check the calendars you want, and click Save selection."
                    : "No events in this range for your selected calendars (or only cancelled items were returned)."}
                </p>
              ) : (
                <ul className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
                  {eventsRows.map((ev) => (
                    <li
                      key={`${ev.calendarId}-${ev.id ?? ev.summary}-${formatEventSchedule(ev)}`}
                      className="border-b border-zinc-800/80 pb-4 last:border-0 last:pb-0"
                    >
                      <p className="text-sm font-medium leading-snug text-zinc-100">
                        {ev.summary?.trim() || "(No title)"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {ev.accountEmail ?? "Google account"}
                      </p>
                      {ev.meetingUrl ? (
                        <p className="mt-2 text-xs leading-relaxed">
                          <span className="text-zinc-500">Join meeting: </span>
                          <a
                            href={ev.meetingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="break-all text-amber-400/90 underline-offset-2 hover:underline"
                          >
                            {ev.meetingUrl}
                          </a>
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs text-zinc-400">
                        {formatEventSchedule(ev)}
                        {ev.transparency === "transparent" ? (
                          <span className="ml-2 text-zinc-600">
                            · shown as free
                          </span>
                        ) : null}
                        {ev.htmlLink ? (
                          <>
                            <span className="mx-1.5 text-zinc-700">·</span>
                            <a
                              href={ev.htmlLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-amber-400/80 underline-offset-2 hover:underline"
                            >
                              Calendar
                            </a>
                          </>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {!eventsLoading ? (
                <p className="text-[11px] text-zinc-600">
                  {eventsRows.length} event
                  {eventsRows.length === 1 ? "" : "s"} in the selected window.
                </p>
              ) : null}
            </section>
          ) : null}

          {dashTab === "sync" ? (
            <>
          <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-zinc-200">
                Connected Google accounts
              </h2>
              <button
                type="button"
                onClick={() => void logoutAll()}
                className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
              >
                Disconnect all
              </button>
            </div>
            <ul className="space-y-2">
              {(me.accounts ?? []).map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2"
                >
                  <span className="text-sm text-zinc-200">
                    {a.email ?? "Google account"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void disconnectAccount(a.id)}
                    className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <a
              href="/api/auth/google?add=1"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-600 bg-zinc-800/50 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800"
            >
              Add another Google account
            </a>
            <p className="text-[11px] leading-relaxed text-zinc-600">
              Each account&apos;s calendars appear together below. Sync can
              mirror busy times across calendars from different Google logins.
            </p>
          </section>

          <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h2 className="text-sm font-medium text-zinc-200">
              Calendars in sync group
            </h2>
            <p className="text-xs text-zinc-500">
              Check every calendar that should both publish and receive busy
              blocks. You need at least two; each must be writable (owner or
              &ldquo;Make changes to events&rdquo;) on at least one connected
              account. After you save, CalSync runs a sync and, when{" "}
              <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300">
                CALSYNC_PUBLIC_URL
              </code>{" "}
              is HTTPS, registers Google push notifications so changes propagate
              within a few seconds. Optional: set{" "}
              <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300">
                CALSYNC_AUTO_SYNC_INTERVAL_SEC
              </code>{" "}
              (e.g. 120) on the server for extra polling while the app is
              running. You can still use{" "}
              <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300">
                POST /api/sync
              </code>{" "}
              from a cron job.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setAddOpen((o) => !o);
                  setAddErr(null);
                }}
                className="rounded-lg border border-zinc-600 bg-zinc-800/50 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                {addOpen ? "Close" : "Add calendar"}
              </button>
            </div>
            {addOpen ? (
              <div className="space-y-4 rounded-lg border border-zinc-700/80 bg-zinc-950/40 p-4">
                {addErr ? (
                  <p
                    className="text-xs text-red-300"
                    role="alert"
                  >
                    {addErr}
                  </p>
                ) : null}
                {(me.accounts ?? []).length > 1 ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-zinc-400">
                      Under which account?
                    </span>
                    <select
                      value={calendarOwnerAccountId}
                      onChange={(e) => setCalendarOwnerAccountId(e.target.value)}
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                    >
                      {(me.accounts ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.email ?? a.id}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-zinc-400">
                    Create a new calendar
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      placeholder="e.g. Work blocks"
                      className="min-w-[12rem] flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
                    />
                    <button
                      type="button"
                      disabled={addBusy !== null || !createName.trim()}
                      onClick={() =>
                        void postCalendar("create", {
                          summary: createName.trim(),
                        })
                      }
                      className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 disabled:opacity-40"
                    >
                      {addBusy === "create" ? "Creating…" : "Create"}
                    </button>
                  </div>
                </div>
                <div className="space-y-2 border-t border-zinc-800 pt-4">
                  <p className="text-xs font-medium text-zinc-400">
                    Add an existing calendar you have access to
                  </p>
                  <p className="text-[11px] leading-relaxed text-zinc-600">
                    Paste the calendar ID (often an email like{" "}
                    <span className="font-mono text-zinc-500">
                      x@group.calendar.google.com
                    </span>
                    ) from Google Calendar → Settings → Integrate calendar.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={addCalendarId}
                      onChange={(e) => setAddCalendarId(e.target.value)}
                      placeholder="calendar ID"
                      className="min-w-[12rem] flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600"
                    />
                    <button
                      type="button"
                      disabled={addBusy !== null || !addCalendarId.trim()}
                      onClick={() =>
                        void postCalendar("add", {
                          calendarId: addCalendarId.trim(),
                        })
                      }
                      className="rounded-lg border border-zinc-600 bg-transparent px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                    >
                      {addBusy === "add" ? "Adding…" : "Add to list"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {calendars.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent px-2 py-1.5 hover:border-zinc-700 hover:bg-zinc-800/50">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                    <span className="text-sm">
                      <span className="text-zinc-100">{c.summary}</span>
                      {c.primary ? (
                        <span className="ml-2 text-xs text-amber-400/90">
                          primary
                        </span>
                      ) : null}
                      {c.accountEmail ? (
                        <span className="ml-2 text-xs text-zinc-500">
                          · {c.accountEmail}
                        </span>
                      ) : null}
                      <span className="mt-0.5 block font-mono text-[11px] text-zinc-600">
                        {c.id}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                disabled={saveBusy}
                onClick={() => void saveConfig()}
                className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
              >
                {saveBusy ? "Saving…" : "Save selection"}
              </button>
              <button
                type="button"
                disabled={syncing || selected.size < 2}
                onClick={() => void runSync()}
                className="rounded-lg border border-zinc-600 bg-transparent px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-40"
              >
                {syncing ? "Syncing…" : "Run sync now"}
              </button>
            </div>
          </section>

          {lastSync ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3 text-sm">
              <p className="font-medium text-zinc-200">Last sync</p>
              <p className="mt-1 text-zinc-400">
                Created {lastSync.created}, updated {lastSync.updated}, deleted{" "}
                {lastSync.deleted}.
              </p>
              {typeof lastSync.eventsListed === "number" ? (
                <p className="mt-1 text-xs text-zinc-500">
                  Google returned {lastSync.eventsListed} event rows in the next{" "}
                  {90} days for the calendars in your sync group (including
                  mirrors CalSync already created).
                </p>
              ) : null}
              {lastSync.skipped ? (
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                  Not mirrored as busy blocks:{" "}
                  {[
                    lastSync.skipped.notBusy > 0 &&
                      `${lastSync.skipped.notBusy} marked “Show as available” (Free)`,
                    lastSync.skipped.calSyncMirror > 0 &&
                      `${lastSync.skipped.calSyncMirror} already CalSync mirrors`,
                    lastSync.skipped.cancelledOrNoId > 0 &&
                      `${lastSync.skipped.cancelledOrNoId} cancelled or without id`,
                    lastSync.skipped.missingStartOrEnd > 0 &&
                      `${lastSync.skipped.missingStartOrEnd} missing start/end`,
                  ]
                    .filter(Boolean)
                    .join("; ")}
                  .
                </p>
              ) : null}
              {lastSync.errors.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-red-300">
                  {lastSync.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
            </>
          ) : null}
        </div>
      )}
    </main>
  );
}
