"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type SVGProps,
} from "react";
import { describeLoginError } from "@/lib/login-error";

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
  /** True when your RSVP on this copy is Declined. */
  declinedBySelf?: boolean;
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

function IconClock(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function IconVideo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M23 7v10l-7-5 7-5z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function eventDayStartMs(ev: ListedEvent): number | null {
  const s = ev.start;
  if (!s) return null;
  if (s.dateTime) {
    const d = new Date(s.dateTime);
    if (Number.isNaN(d.getTime())) return null;
    return startOfLocalDay(d);
  }
  if (s.date) return startOfLocalDay(parseGCalDate(s.date));
  return null;
}

function formatDayHeading(dayMs: number): string {
  const d = new Date(dayMs);
  const now = new Date();
  const y = now.getFullYear();
  const today0 = startOfLocalDay(now);
  const tomorrow0 = today0 + 86_400_000;
  if (dayMs === today0) return "Today";
  if (dayMs === tomorrow0) return "Tomorrow";
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() !== y
      ? { weekday: "long", month: "short", day: "numeric", year: "numeric" }
      : { weekday: "long", month: "short", day: "numeric" };
  return d.toLocaleDateString(undefined, opts);
}

/** Time / schedule line for an event when a day section header already shows the date. */
function formatEventTimeInDay(ev: ListedEvent, groupDayMs: number): string {
  const s = ev.start;
  const e = ev.end;
  if (!s) return "—";

  if (s.date && !s.dateTime) {
    const sd = s.date;
    const ed = e?.date;
    const sdt = parseGCalDate(sd);
    const start0 = startOfLocalDay(sdt);
    if (!ed) {
      return start0 === groupDayMs
        ? "All day"
        : sdt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    const edt = parseGCalDate(ed);
    const dayMs = 86_400_000;
    const span = edt.getTime() - sdt.getTime();
    if (span <= dayMs) {
      return start0 === groupDayMs
        ? "All day"
        : sdt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  const sameDay = startOfLocalDay(start) === startOfLocalDay(end);
  const tfmt: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  const a = start.toLocaleTimeString(undefined, tfmt);
  const b = end.toLocaleTimeString(undefined, tfmt);
  if (sameDay && startOfLocalDay(start) === groupDayMs) {
    return `${a} – ${b}`;
  }
  if (sameDay) {
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
    if (datePrefix === "Today" || datePrefix === "Tomorrow") {
      return `${datePrefix} ${a}–${b}`;
    }
    return `${datePrefix} • ${a}–${b}`;
  }
  return `${start.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} – ${end.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

/** Short label (mobile), full label (desktop), and accessible name for join links. */
function meetingJoinInfo(url: string): {
  shortLabel: string;
  fullLabel: string;
  ariaLabel: string;
} {
  try {
    const u = new URL(url);
    if (u.protocol === "facetime:")
      return {
        shortLabel: "FaceTime",
        fullLabel: "Join FaceTime",
        ariaLabel: "Join FaceTime call",
      };
    const h = u.hostname.toLowerCase();
    if (h.includes("meet.google"))
      return {
        shortLabel: "Meet",
        fullLabel: "Join Google Meet",
        ariaLabel: "Join Google Meet",
      };
    if (h.includes("zoom.us"))
      return {
        shortLabel: "Zoom",
        fullLabel: "Join Zoom",
        ariaLabel: "Join Zoom meeting",
      };
    if (h.includes("facetime.apple.com"))
      return {
        shortLabel: "FaceTime",
        fullLabel: "Join FaceTime",
        ariaLabel: "Join FaceTime call",
      };
    if (h.includes("teams.microsoft"))
      return {
        shortLabel: "Teams",
        fullLabel: "Join Teams",
        ariaLabel: "Join Microsoft Teams meeting",
      };
    if (h.includes("webex.com"))
      return {
        shortLabel: "Webex",
        fullLabel: "Join Webex",
        ariaLabel: "Join Webex meeting",
      };
  } catch {
    /* ignore */
  }
  return {
    shortLabel: "Video",
    fullLabel: "Join meeting",
    ariaLabel: "Join video meeting",
  };
}

function eventTimedBounds(
  ev: ListedEvent
): { start: number; end: number } | null {
  const s = ev.start?.dateTime;
  const e = ev.end?.dateTime;
  if (!s || !e) return null;
  const start = new Date(s).getTime();
  const end = new Date(e).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return { start, end };
}

/** Busy interval in ms for overlap checks (timed or all-day, local calendar). */
function eventBusyInterval(ev: ListedEvent): {
  start: number;
  end: number;
} | null {
  const timed = eventTimedBounds(ev);
  if (timed) return timed;
  const s = ev.start;
  if (s?.date && !s.dateTime) {
    const startDay = startOfLocalDay(parseGCalDate(s.date));
    let endExclusive: number;
    if (ev.end?.date) {
      endExclusive = startOfLocalDay(parseGCalDate(ev.end.date));
    } else {
      endExclusive = startDay + 86_400_000;
    }
    if (endExclusive <= startDay) return null;
    return { start: startDay, end: endExclusive };
  }
  return null;
}

function intervalsOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number }
): boolean {
  return a.start < b.end && b.start < a.end;
}

function agendaEventStableKey(ev: ListedEvent): string {
  return `${ev.calendarId}\0${ev.id ?? "noid"}\0${ev.start?.dateTime ?? ev.start?.date ?? ""}`;
}

/** Events whose time range overlaps another visible (non-ended) agenda event. */
/** Overlaps count as conflicts only when both events are still accepted (not declined). */
function computeConflictKeys(events: ListedEvent[]): Set<string> {
  const withIv: {
    ev: ListedEvent;
    key: string;
    iv: { start: number; end: number };
  }[] = [];
  for (const ev of events) {
    const iv = eventBusyInterval(ev);
    if (!iv) continue;
    withIv.push({ ev, key: agendaEventStableKey(ev), iv });
  }
  const conflicted = new Set<string>();
  for (let i = 0; i < withIv.length; i++) {
    for (let j = i + 1; j < withIv.length; j++) {
      if (!intervalsOverlap(withIv[i].iv, withIv[j].iv)) continue;
      if (withIv[i].ev.declinedBySelf || withIv[j].ev.declinedBySelf) {
        continue;
      }
      conflicted.add(withIv[i].key);
      conflicted.add(withIv[j].key);
    }
  }
  return conflicted;
}

/** All-day event: local calendar day `now` falls on an in-range day (end exclusive). */
function allDayActiveNow(ev: ListedEvent, now: Date): boolean {
  const s = ev.start;
  if (!s?.date || s.dateTime) return false;
  const startDay = startOfLocalDay(parseGCalDate(s.date));
  let endExclusive: number;
  if (ev.end?.date) {
    endExclusive = startOfLocalDay(parseGCalDate(ev.end.date));
  } else {
    endExclusive = startDay + 86_400_000;
  }
  const now0 = startOfLocalDay(now);
  return now0 >= startDay && now0 < endExclusive;
}

/** When the event is fully over (timed: end datetime; all-day: exclusive end date at local midnight). */
function eventEndInstantMs(ev: ListedEvent): number | null {
  const timed = eventTimedBounds(ev);
  if (timed) return timed.end;
  const s = ev.start;
  if (s?.date && !s.dateTime) {
    if (ev.end?.date) {
      return startOfLocalDay(parseGCalDate(ev.end.date));
    }
    return startOfLocalDay(parseGCalDate(s.date)) + 86_400_000;
  }
  if (s?.dateTime && ev.end?.dateTime) {
    const startMs = new Date(s.dateTime).getTime();
    const endMs = new Date(ev.end.dateTime).getTime();
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs) {
      return endMs;
    }
  }
  return null;
}

function eventHasEnded(ev: ListedEvent, now: Date): boolean {
  const endMs = eventEndInstantMs(ev);
  if (endMs == null) return false;
  return now.getTime() >= endMs;
}

/** Badge color from time remaining until start (upcoming) or until end (live). */
function listHeadBadgeTone(remainingMs: number): "gray" | "green" | "yellow" | "red" {
  if (remainingMs >= 3_600_000) return "gray";
  if (remainingMs >= 30 * 60_000) return "green";
  if (remainingMs >= 10 * 60_000) return "yellow";
  return "red";
}

const LIST_HEAD_BADGE_TONE_CLASS: Record<
  ReturnType<typeof listHeadBadgeTone>,
  string
> = {
  gray: "bg-zinc-800/70 text-zinc-400",
  green: "bg-emerald-950/60 text-emerald-300",
  yellow: "bg-yellow-950/55 text-yellow-200",
  red: "bg-red-950/55 text-red-300",
};

function formatStartsIn(ms: number): string {
  if (ms < 60_000) return "Starting soon";
  if (ms < 3_600_000) {
    const m = Math.max(1, Math.ceil(ms / 60_000));
    return `Starts in ${m} min`;
  }
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.ceil((ms % 3_600_000) / 60_000);
    if (m === 60) return `Starts in ${h + 1}h`;
    if (m === 0 || h === 0) {
      if (h === 0) return `Starts in ${m} min`;
      return `Starts in ${h}h`;
    }
    return `Starts in ${h}h ${m}m`;
  }
  const d = Math.ceil(ms / 86_400_000);
  if (d === 1) return "Starts tomorrow";
  return `Starts in ${d} days`;
}

type ListHeadStatus =
  | { type: "live_timed"; remainingMin: number; remainingMs: number }
  | { type: "live_allday" }
  | { type: "upcoming"; label: string; remainingMs?: number };

function computeListHeadStatus(ev: ListedEvent, now: Date): ListHeadStatus | null {
  const t = now.getTime();
  const bounds = eventTimedBounds(ev);
  if (bounds) {
    if (t >= bounds.end) return null;
    if (t >= bounds.start) {
      const remainingMs = bounds.end - t;
      const remainingMin = Math.max(1, Math.ceil(remainingMs / 60_000));
      return { type: "live_timed", remainingMin, remainingMs };
    }
    return {
      type: "upcoming",
      label: formatStartsIn(bounds.start - t),
      remainingMs: bounds.start - t,
    };
  }
  if (allDayActiveNow(ev, now)) {
    return { type: "live_allday" };
  }
  if (ev.start?.date && !ev.start.dateTime) {
    const startDay = startOfLocalDay(parseGCalDate(ev.start.date));
    const now0 = startOfLocalDay(now);
    if (startDay > now0) {
      const daysUntil = Math.round((startDay - now0) / 86_400_000);
      if (daysUntil === 1) {
        return { type: "upcoming", label: "Starts tomorrow (all day)" };
      }
      return {
        type: "upcoming",
        label: `Starts in ${daysUntil} days (all day)`,
      };
    }
  }
  return null;
}

function MeetingJoinLink({
  url,
  mutedOutline,
  variant,
}: {
  url: string;
  mutedOutline?: boolean;
  variant: "primary" | "outline";
}) {
  const focusRing =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  const { shortLabel, fullLabel, ariaLabel } = meetingJoinInfo(url);
  const iconClass = "h-3.5 w-3.5 shrink-0";
  const labelInner = (
    <>
      <span className="sm:hidden">{shortLabel}</span>
      <span className="hidden sm:inline">{fullLabel}</span>
    </>
  );
  if (mutedOutline || variant === "outline") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel}
        className={`inline-flex max-w-full shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-600/80 bg-transparent px-2.5 py-2 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300 sm:px-3 ${focusRing} focus-visible:outline-zinc-500`}
      >
        <IconVideo className={iconClass} />
        {labelInner}
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      className={`inline-flex max-w-full shrink-0 items-center justify-center gap-1.5 rounded-md bg-sky-600/90 px-2.5 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500 sm:px-3 ${focusRing} focus-visible:outline-sky-400`}
    >
      <IconVideo className={iconClass} />
      {labelInner}
    </a>
  );
}

function listHeadTagText(status: ListHeadStatus): string {
  if (status.type === "live_timed") {
    return `Ends in ${status.remainingMin} min`;
  }
  if (status.type === "live_allday") {
    return "All day";
  }
  return status.label;
}

function ListHeadTag({
  status,
  muted,
}: {
  status: ListHeadStatus;
  muted?: boolean;
}) {
  let tone: keyof typeof LIST_HEAD_BADGE_TONE_CLASS = "gray";
  if (status.type === "live_timed") {
    tone = listHeadBadgeTone(status.remainingMs);
  } else if (status.type === "upcoming" && status.remainingMs != null) {
    tone = listHeadBadgeTone(status.remainingMs);
  }
  const toneClass = muted
    ? "border border-zinc-600/70 bg-zinc-900/60 text-zinc-500"
    : LIST_HEAD_BADGE_TONE_CLASS[tone];
  return (
    <span
      role="status"
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${toneClass}`}
    >
      {listHeadTagText(status)}
    </span>
  );
}

function AgendaEventRow({
  ev,
  groupDayMs,
  isListHead,
  now,
  declinedHidden,
  isFirstInAgenda,
  hasConflict,
}: {
  ev: ListedEvent;
  groupDayMs?: number;
  isListHead: boolean;
  now: Date;
  declinedHidden: boolean;
  isFirstInAgenda: boolean;
  hasConflict: boolean;
}) {
  const timeLabel =
    groupDayMs != null
      ? formatEventTimeInDay(ev, groupDayMs)
      : formatEventSchedule(ev);
  const headStatus = isListHead ? computeListHeadStatus(ev, now) : null;
  const declined = Boolean(ev.declinedBySelf);
  const muted = declined;

  const inner = (
    <div className="flex flex-row items-start justify-between gap-3 sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <EventTitle ev={ev} muted={muted} />
          {declined ? (
            <span className="inline-flex shrink-0 items-center rounded-full border border-zinc-600/60 bg-zinc-900/40 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
              Declined
            </span>
          ) : null}
          {hasConflict ? (
            <span className="inline-flex shrink-0 items-center rounded-full border border-amber-700/50 bg-amber-950/45 px-2 py-0.5 text-[11px] font-medium text-amber-200/95">
              Conflict
            </span>
          ) : null}
          {headStatus ? (
            <ListHeadTag status={headStatus} muted={muted} />
          ) : null}
        </div>
        <div
          className={`flex max-w-full flex-nowrap items-center gap-x-3 overflow-x-auto text-xs [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${muted ? "text-zinc-600" : "text-zinc-500"}`}
        >
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <IconClock
              className={`h-3.5 w-3.5 shrink-0 ${muted ? "text-zinc-700" : "text-zinc-600"}`}
            />
            <span
              className={`whitespace-nowrap tabular-nums ${muted ? "text-zinc-500" : "text-zinc-400"}`}
            >
              {timeLabel}
            </span>
          </span>
          <span
            className={`shrink-0 ${muted ? "text-zinc-700" : "text-zinc-600"}`}
          >
            ·
          </span>
          <span
            className={`inline-flex min-w-0 shrink items-center gap-1.5 text-[11px] ${muted ? "text-zinc-600" : "text-zinc-500"}`}
            title={ev.calendarSummary}
          >
            <IconCalendar
              className={`h-3 w-3 shrink-0 ${muted ? "text-zinc-700" : "text-zinc-600"}`}
            />
            <span className="min-w-0 truncate">{ev.calendarSummary}</span>
          </span>
        </div>
        {showAccountEmailBelow(ev) ? (
          <p
            className={`text-[11px] ${muted ? "text-zinc-600/90" : "text-zinc-600"}`}
          >
            {ev.accountEmail ?? "Google account"}
          </p>
        ) : null}
      </div>
      {ev.meetingUrl ? (
        <div className="flex min-w-0 shrink-0 flex-col items-end self-start pt-0.5 sm:min-w-[9rem] sm:self-center sm:pt-0">
          <MeetingJoinLink
            url={ev.meetingUrl}
            mutedOutline={muted}
            variant={muted || !isListHead ? "outline" : "primary"}
          />
        </div>
      ) : null}
    </div>
  );

  const padY = isFirstInAgenda ? "pt-0 pb-5" : "py-5";

  if (!declined) {
    return (
      <li
        className={`border-b border-zinc-800/50 ${padY} motion-reduce:transition-none`}
      >
        {inner}
      </li>
    );
  }

  return (
    <li
      className={`grid min-h-0 border-zinc-800/50 transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
        declinedHidden
          ? "grid-rows-[0fr] border-b-0"
          : `grid-rows-[1fr] border-b ${padY}`
      }`}
      aria-hidden={declinedHidden}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={`transition-opacity duration-200 ease-out motion-reduce:transition-none ${
            declinedHidden
              ? "pointer-events-none opacity-0"
              : "opacity-100"
          }`}
        >
          {inner}
        </div>
      </div>
    </li>
  );
}

function isAgendaListHead(
  ev: ListedEvent,
  groupDayMs: number | undefined,
  head: {
    calendarId: string;
    id: string | null;
    startKey: string;
    dayMs: number | null;
    nodate: boolean;
  } | null
): boolean {
  if (!head) return false;
  const sk = ev.start?.dateTime ?? ev.start?.date ?? "";
  if (
    ev.calendarId !== head.calendarId ||
    ev.id !== head.id ||
    sk !== head.startKey
  ) {
    return false;
  }
  if (head.nodate) return groupDayMs === undefined;
  return groupDayMs === head.dayMs;
}

function groupEventsByLocalDay(rows: ListedEvent[]): {
  groups: { dayMs: number; label: string; events: ListedEvent[] }[];
  noDay: ListedEvent[];
} {
  const map = new Map<number, ListedEvent[]>();
  const noDay: ListedEvent[] = [];
  for (const ev of rows) {
    const ms = eventDayStartMs(ev);
    if (ms == null) {
      noDay.push(ev);
      continue;
    }
    if (!map.has(ms)) map.set(ms, []);
    map.get(ms)!.push(ev);
  }
  const groups = [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayMs, events]) => ({
      dayMs,
      label: formatDayHeading(dayMs),
      events,
    }));
  return { groups, noDay };
}

/** Calendar list row often repeats the owning account email; show the extra line only when it adds info. */
function showAccountEmailBelow(ev: ListedEvent): boolean {
  const acct = ev.accountEmail?.trim().toLowerCase() ?? "";
  const cal = ev.calendarSummary?.trim().toLowerCase() ?? "";
  if (!acct) return true;
  if (cal && acct === cal) return false;
  return true;
}

function EventTitle({ ev, muted }: { ev: ListedEvent; muted?: boolean }) {
  const text = ev.summary?.trim() || "(No title)";
  const base = "text-[15px] font-medium leading-snug";
  if (!ev.htmlLink) {
    return (
      <p
        className={`${base} max-w-full ${muted ? "inline-block w-fit text-zinc-500" : "text-zinc-50"}`}
      >
        {text}
      </p>
    );
  }
  return (
    <a
      href={ev.htmlLink}
      target="_blank"
      rel="noopener noreferrer"
      className={`${base} block w-fit max-w-full underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 ${
        muted
          ? "text-zinc-500 decoration-zinc-700 transition-colors duration-150 hover:bg-zinc-900/50 hover:text-zinc-400 hover:underline"
          : "text-zinc-50 decoration-zinc-600 hover:text-white hover:underline"
      }`}
    >
      {text}
    </a>
  );
}

function EventsAgendaSkeleton() {
  const bar =
    "animate-pulse rounded-md bg-zinc-800/50 motion-reduce:animate-none";
  return (
    <div
      className="space-y-10"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading events"
    >
      {[0, 1].map((group) => (
        <div key={group}>
          <div className={`mb-3 h-3.5 w-28 ${bar}`} />
          <ul className="flex flex-col">
            {[0, 1, 2].map((row) => (
              <li key={row} className="border-b border-zinc-800/50 py-5">
                <div className="space-y-2.5">
                  <div className={`h-4 max-w-sm ${bar}`} />
                  <div className={`h-3 max-w-[14rem] ${bar}`} />
                  <div className={`h-3 max-w-[10rem] ${bar}`} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function DeclinedEventsSwitch({
  show,
  onShowChange,
}: {
  show: boolean;
  onShowChange: (next: boolean) => void;
}) {
  const id = "dash-show-declined";
  return (
    <div className="inline-flex flex-col gap-1">
      <span className="text-xs font-medium text-zinc-400" id={`${id}-label`}>
        Declined events
      </span>
      <div className="flex min-h-10 items-center">
        <button
          type="button"
          role="switch"
          aria-checked={show}
          aria-labelledby={`${id}-label`}
          onClick={() => onShowChange(!show)}
          className={`cursor-pointer flex h-8 w-14 shrink-0 items-center rounded-full border p-1 transition-colors duration-200 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none ${
            show
              ? "border-sky-600/90 bg-sky-600/90 hover:border-sky-500 hover:bg-sky-500 focus-visible:outline-sky-400"
              : "border-zinc-700 bg-zinc-900 focus-visible:outline-zinc-400"
          }`}
        >
          <span
            className={`pointer-events-none h-6 w-6 shrink-0 rounded-full shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none ${
              show
                ? "translate-x-6 bg-white"
                : "translate-x-0 bg-zinc-100"
            }`}
            aria-hidden
          />
        </button>
      </div>
    </div>
  );
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
      declinedByYou: number;
      missingStartOrEnd: number;
    };
  } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [dashTab, setDashTab] = useState<"sync" | "events">("events");
  const [eventsDays, setEventsDays] = useState(7);
  const [showDeclinedEvents, setShowDeclinedEvents] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsErr, setEventsErr] = useState<string | null>(null);
  const [eventsRows, setEventsRows] = useState<ListedEvent[]>([]);
  const [eventsLoadWarnings, setEventsLoadWarnings] = useState<string[]>([]);
  const [clearMirrorsBusy, setClearMirrorsBusy] = useState<string | null>(null);
  const [clearMirrorsNote, setClearMirrorsNote] = useState<string | null>(null);

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
        return;
      }
      const cr = await fetch("/api/calendars");
      const calBody = await cr.text();
      let cj: { calendars?: Cal[]; error?: string; message?: string } = {};
      if (calBody.trim()) {
        try {
          cj = JSON.parse(calBody) as typeof cj;
        } catch {
          throw new Error("Could not load calendars (invalid server response)");
        }
      }
      if (!cr.ok) {
        throw new Error(
          cj.message || cj.error || "Could not load calendars"
        );
      }
      setCalendars(cj.calendars ?? []);
      const ids = m.syncCalendarIds ?? [];
      const known = new Set((cj.calendars ?? []).map((c) => c.id));
      const fromServer = ids.filter((id) => known.has(id));
      if (fromServer.length) {
        setSelected(new Set(fromServer));
      } else {
        const primaries = (cj.calendars ?? [])
          .filter((c) => c.primary)
          .map((c) => c.id);
        setSelected(new Set(primaries));
      }
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const e = p.get("error");
    if (e) setUrlError(describeLoginError(e) ?? e);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const savedSyncGroupKey = useMemo(
    () => (me?.syncCalendarIds ?? []).join("\0"),
    [me?.syncCalendarIds]
  );
  const savedSyncCount = (me?.syncCalendarIds ?? []).length;
  /** Checkboxes can default to primaries while the server still has no sync group. */
  const selectionSavedForSync = savedSyncCount >= 2;

  const loadEvents = useCallback(
    async (opts?: { silent?: boolean; signal?: AbortSignal }) => {
      const silent = opts?.silent ?? false;
      const signal = opts?.signal;
      if (!me?.connected) return;
      if (!silent) {
        setEventsLoading(true);
        setEventsErr(null);
        setEventsLoadWarnings([]);
      }
      try {
        const qs = new URLSearchParams({ days: String(eventsDays) });
        const r = await fetch(`/api/events?${qs.toString()}`, { signal });
        const raw = await r.text();
        let j: {
          events?: ListedEvent[];
          loadErrors?: string[];
          error?: string;
          message?: string;
        } = {};
        if (raw.trim()) {
          try {
            j = JSON.parse(raw) as typeof j;
          } catch {
            throw new Error("Invalid response from events API");
          }
        }
        if (signal?.aborted) return;
        if (!r.ok) {
          throw new Error(j.message || j.error || r.statusText);
        }
        setEventsRows(j.events ?? []);
        setEventsLoadWarnings(j.loadErrors ?? []);
        if (!silent) setEventsErr(null);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        if (!silent) {
          setEventsErr(e instanceof Error ? e.message : String(e));
          setEventsRows([]);
          setEventsLoadWarnings([]);
        }
      } finally {
        if (!silent) setEventsLoading(false);
      }
    },
    [eventsDays, me?.connected]
  );

  const [eventsNowTick, setEventsNowTick] = useState(0);
  const agendaNow = useMemo(() => {
    void eventsNowTick;
    return new Date();
  }, [eventsNowTick]);

  const visibleEventRows = useMemo(
    () => eventsRows.filter((ev) => !eventHasEnded(ev, agendaNow)),
    [eventsRows, agendaNow]
  );

  const conflictKeys = useMemo(
    () => computeConflictKeys(visibleEventRows),
    [visibleEventRows]
  );

  const expandedVisibleEventRows = useMemo(
    () =>
      visibleEventRows.filter(
        (ev) => !ev.declinedBySelf || showDeclinedEvents
      ),
    [visibleEventRows, showDeclinedEvents]
  );

  const eventsGrouped = useMemo(
    () => groupEventsByLocalDay(visibleEventRows),
    [visibleEventRows]
  );

  const expandedGrouped = useMemo(
    () => groupEventsByLocalDay(expandedVisibleEventRows),
    [expandedVisibleEventRows]
  );

  const listHeadIdentity = useMemo(() => {
    const g0 = expandedGrouped.groups[0]?.events[0];
    if (g0) {
      return {
        calendarId: g0.calendarId,
        id: g0.id,
        startKey: g0.start?.dateTime ?? g0.start?.date ?? "",
        dayMs: expandedGrouped.groups[0].dayMs,
        nodate: false as const,
      };
    }
    const nd = expandedGrouped.noDay[0];
    if (nd) {
      return {
        calendarId: nd.calendarId,
        id: nd.id,
        startKey: nd.start?.dateTime ?? nd.start?.date ?? "",
        dayMs: null,
        nodate: true as const,
      };
    }
    return null;
  }, [expandedGrouped]);

  const calendarsByAccount = useMemo(() => {
    const byAcc = new Map<string, Cal[]>();
    for (const c of calendars) {
      const list = byAcc.get(c.accountId);
      if (list) list.push(c);
      else byAcc.set(c.accountId, [c]);
    }
    const groups = Array.from(byAcc.entries()).map(([accountId, cals]) => {
      const sorted = [...cals].sort((a, b) => {
        const ap = a.primary ? 1 : 0;
        const bp = b.primary ? 1 : 0;
        if (bp !== ap) return bp - ap;
        return a.summary.localeCompare(b.summary);
      });
      const accountLabel = sorted[0]?.accountEmail ?? "Google account";
      return { accountId, accountLabel, calendars: sorted };
    });
    groups.sort((a, b) =>
      a.accountLabel.localeCompare(b.accountLabel, undefined, {
        sensitivity: "base",
      })
    );
    return groups;
  }, [calendars]);

  useEffect(() => {
    if (dashTab !== "events" || eventsRows.length === 0) return;
    const id = window.setInterval(() => {
      setEventsNowTick((t) => t + 1);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [dashTab, eventsRows.length]);

  useEffect(() => {
    if (dashTab !== "events" || eventsRows.length === 0) return;
    const nowMs = Date.now();
    let nextEnd = Infinity;
    for (const ev of eventsRows) {
      const end = eventEndInstantMs(ev);
      if (end != null && end > nowMs) nextEnd = Math.min(nextEnd, end);
    }
    if (!Number.isFinite(nextEnd)) return;
    const delay = Math.max(0, nextEnd - nowMs) + 250;
    const id = window.setTimeout(() => {
      setEventsNowTick((t) => t + 1);
    }, delay);
    return () => window.clearTimeout(id);
  }, [dashTab, eventsRows, eventsNowTick]);

  useEffect(() => {
    if (dashTab !== "events" || !me?.connected) return;
    const ac = new AbortController();
    void loadEvents({ silent: false, signal: ac.signal });
    return () => ac.abort();
  }, [dashTab, eventsDays, me?.connected, savedSyncGroupKey, loadEvents]);

  useEffect(() => {
    if (dashTab !== "events" || !me?.connected) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadEvents({ silent: true });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [dashTab, me?.connected, loadEvents]);

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
        const j = (await r.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(
          j.message || j.error || r.statusText || "Save failed"
        );
      }
      await refresh();
      window.setTimeout(() => void loadEvents({ silent: true }), 4000);
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
      void loadEvents({ silent: true });
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

  const clearMirrorsForCalendar = async (calendarId: string, summary: string) => {
    setClearMirrorsNote(null);
    const ok = window.confirm(
      `Remove all CalSync mirrored busy blocks from “${summary}”? Your own events are not deleted.`
    );
    if (!ok) return;
    setClearMirrorsBusy(calendarId);
    try {
      const r = await fetch("/api/calendars/clear-mirrors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId }),
      });
      const j = (await r.json()) as {
        deleted?: number;
        errors?: string[];
        message?: string;
        error?: string;
      };
      if (!r.ok) {
        throw new Error(j.message || j.error || "Request failed");
      }
      const n = j.deleted ?? 0;
      const errList = j.errors ?? [];
      setClearMirrorsNote(
        errList.length
          ? `Removed ${n} mirror block(s); some errors: ${errList.join("; ")}`
          : `Removed ${n} mirror block${n === 1 ? "" : "s"} from “${summary}”.`
      );
      void loadEvents({ silent: true });
    } catch (e) {
      setClearMirrorsNote(
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setClearMirrorsBusy(null);
    }
  };

  const displayError = useMemo(
    () => urlError || loadErr,
    [urlError, loadErr]
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-6 sm:gap-8 sm:py-12">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            CalSync
          </h1>
          {!loading ? (
            <button
              type="button"
              onClick={() => void signOutDashboard()}
              className="cursor-pointer shrink-0 text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
            >
              Sign out
            </button>
          ) : null}
        </div>
      </header>

      {displayError ? (
        <div
          className="whitespace-pre-line rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm leading-relaxed text-red-200"
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
            Connect Google Calendar to grant access. Your refresh token and sync
            preferences are stored in this instance&apos;s database—not only on
            your device—so use deployments you trust. Whoever runs this app
            should secure and back up that database.
          </p>
          <a
            href="/api/auth/google"
            className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
          >
            Connect Google Calendar
          </a>
          <p className="text-xs leading-relaxed text-zinc-500">
            CalSync is experimental and under active development. Use at your own
            risk—it may change, break, or mishandle calendar data. Do not rely on
            it for critical or compliance-sensitive scheduling.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div
            className="flex gap-8 border-b border-zinc-800/50 text-sm"
            role="tablist"
            aria-label="Dashboard sections"
          >
            <button
              type="button"
              role="tab"
              aria-selected={dashTab === "events"}
              onClick={() => setDashTab("events")}
              className={`-mb-px cursor-pointer border-b-2 pb-3 font-medium transition-colors ${
                dashTab === "events"
                  ? "border-zinc-100 text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Meetings
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={dashTab === "sync"}
              onClick={() => setDashTab("sync")}
              className={`-mb-px cursor-pointer border-b-2 pb-3 font-medium transition-colors ${
                dashTab === "sync"
                  ? "border-zinc-100 text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Settings
            </button>
          </div>

          {dashTab === "events" ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-end gap-6 gap-y-3">
                  <label className="inline-flex w-full max-w-xs flex-col gap-1">
                    <span className="text-xs font-medium text-zinc-400">
                      Time range
                    </span>
                    <select
                      value={eventsDays}
                      onChange={(e) => setEventsDays(Number(e.target.value))}
                      className="min-w-[11rem] w-full max-w-xs cursor-pointer appearance-none rounded-md border border-zinc-800/50 bg-transparent py-2 pl-3 pr-10 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23a1a1aa' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                        backgroundSize: "1.125rem",
                        backgroundPosition: "right 0.65rem center",
                        backgroundRepeat: "no-repeat",
                      }}
                    >
                      <option value={7}>Next 7 days</option>
                      <option value={30}>Next 30 days</option>
                      <option value={90}>Next 90 days</option>
                    </select>
                  </label>
                  <DeclinedEventsSwitch
                    show={showDeclinedEvents}
                    onShowChange={setShowDeclinedEvents}
                  />
              </div>
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
                <EventsAgendaSkeleton />
              ) : expandedVisibleEventRows.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  {eventsRows.length === 0
                    ? savedSyncGroupKey === ""
                      ? selected.size >= 2
                        ? "Calendars look selected in Settings, but your sync group is not saved yet. Open Settings and click Save selection."
                        : "No calendars in your saved sync group. Open Settings, check at least two calendars, and click Save selection."
                      : "No events in this range for your selected calendars (or only cancelled or “free” items were returned)."
                    : visibleEventRows.length > 0 && !showDeclinedEvents
                      ? "Declined events are hidden. Turn on Declined events to see them in the list."
                      : "Nothing scheduled right now. Earlier events in this range have ended."}
                </p>
              ) : (
                <div className="space-y-10">
                  {eventsGrouped.groups.map((group, gi) => (
                    <div key={group.dayMs}>
                      <h3 className="sticky top-0 z-10 -mx-1 mb-3 border-b border-zinc-800/60 bg-[var(--background)] px-1 py-2 text-xs font-medium tracking-wide text-zinc-500">
                        {group.label}
                      </h3>
                      <ul className="flex flex-col">
                        {group.events.map((ev, ei) => (
                          <AgendaEventRow
                            key={`${ev.calendarId}-${ev.id ?? "noid"}-${ev.summary ?? ""}-${group.dayMs}`}
                            ev={ev}
                            groupDayMs={group.dayMs}
                            isListHead={isAgendaListHead(
                              ev,
                              group.dayMs,
                              listHeadIdentity
                            )}
                            now={agendaNow}
                            declinedHidden={
                              Boolean(ev.declinedBySelf) && !showDeclinedEvents
                            }
                            isFirstInAgenda={gi === 0 && ei === 0}
                            hasConflict={conflictKeys.has(
                              agendaEventStableKey(ev)
                            )}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                  {eventsGrouped.noDay.length > 0 ? (
                    <div>
                      <h3 className="sticky top-0 z-10 -mx-1 mb-3 border-b border-zinc-800/60 bg-[var(--background)] px-1 py-2 text-xs font-medium tracking-wide text-zinc-500">
                        Other
                      </h3>
                      <ul className="flex flex-col">
                        {eventsGrouped.noDay.map((ev, ni) => (
                          <AgendaEventRow
                            key={`${ev.calendarId}-${ev.id ?? "noid"}-${ev.summary ?? ""}-nodate`}
                            ev={ev}
                            isListHead={isAgendaListHead(
                              ev,
                              undefined,
                              listHeadIdentity
                            )}
                            now={agendaNow}
                            declinedHidden={
                              Boolean(ev.declinedBySelf) && !showDeclinedEvents
                            }
                            isFirstInAgenda={
                              eventsGrouped.groups.length === 0 && ni === 0
                            }
                            hasConflict={conflictKeys.has(
                              agendaEventStableKey(ev)
                            )}
                          />
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
              {!eventsLoading &&
              eventsRows.length > 0 &&
              (expandedVisibleEventRows.length > 0 ||
                visibleEventRows.length === 0) ? (
                <p className="text-[11px] text-zinc-600">
                  {expandedVisibleEventRows.length} event
                  {expandedVisibleEventRows.length === 1 ? "" : "s"} on your
                  agenda
                  {eventsRows.length > visibleEventRows.length
                    ? ` (${eventsRows.length - visibleEventRows.length} already ended in this range)`
                    : ""}
                  .
                </p>
              ) : null}
            </section>
          ) : null}

          {dashTab === "sync" ? (
            <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-zinc-200">
                Connected Google accounts
              </h2>
              <button
                type="button"
                onClick={() => void logoutAll()}
              className="cursor-pointer text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
              >
                Disconnect all
              </button>
            </div>
            <ul className="divide-y divide-zinc-800/50">
              {(me.accounts ?? []).map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <span className="text-sm text-zinc-200">
                    {a.email ?? "Google account"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void disconnectAccount(a.id)}
                    className="cursor-pointer text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <a
              href="/api/auth/google?add=1"
              className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-zinc-600 bg-transparent px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800"
            >
              Add another Google account
            </a>
            <p className="text-[11px] leading-relaxed text-zinc-600">
              Each account&apos;s calendars appear together below. Sync can
              mirror busy times across calendars from different Google logins.
            </p>
          </section>

          <section className="space-y-3 border-t border-zinc-800/50 pt-8">
            <h2 className="text-sm font-medium text-zinc-200">
              Calendars in sync group
            </h2>
            {clearMirrorsNote ? (
              <p
                className={`rounded-lg border px-3 py-2 text-xs ${
                  clearMirrorsNote.startsWith("Removed") &&
                  !clearMirrorsNote.includes("some errors")
                    ? "border-zinc-700/60 bg-zinc-900/40 text-zinc-300"
                    : clearMirrorsNote.startsWith("Removed")
                      ? "border-amber-900/40 bg-amber-950/20 text-amber-200/90"
                      : "border-red-900/50 bg-red-950/30 text-red-200/90"
                }`}
                role="status"
              >
                {clearMirrorsNote}
              </p>
            ) : null}
            <div className="space-y-6">
              {calendarsByAccount.map((g) => (
                <div key={g.accountId}>
                  <p className="mb-2 text-xs font-medium text-zinc-500">
                    {g.accountLabel}
                  </p>
                  <ul className="divide-y divide-zinc-800/40">
                    {g.calendars.map((c) => (
                      <li key={c.id}>
                        <div className="flex flex-wrap items-start justify-between gap-2 py-3 hover:bg-zinc-900/30">
                          <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={selected.has(c.id)}
                              onChange={() => toggle(c.id)}
                            />
                            <span className="text-sm">
                              <span className="text-zinc-100">
                                {c.summary}
                              </span>
                              {c.primary ? (
                                <span className="ml-2 text-xs text-amber-400/90">
                                  primary
                                </span>
                              ) : null}
                            </span>
                          </label>
                          <button
                            type="button"
                            disabled={clearMirrorsBusy === c.id}
                            onClick={() =>
                              void clearMirrorsForCalendar(c.id, c.summary)
                            }
                            className="cursor-pointer shrink-0 text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {clearMirrorsBusy === c.id
                              ? "Clearing…"
                              : "Clear mirrors"}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                disabled={saveBusy}
                onClick={() => void saveConfig()}
                className="cursor-pointer rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveBusy ? "Saving…" : "Save selection"}
              </button>
              <button
                type="button"
                disabled={syncing || !selectionSavedForSync}
                onClick={() => void runSync()}
                className="cursor-pointer rounded-lg border border-zinc-600 bg-transparent px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {syncing ? "Syncing…" : "Run sync now"}
              </button>
            </div>
            {!selectionSavedForSync ? (
              <p className="text-xs leading-relaxed text-zinc-500">
                {selected.size < 2
                  ? "Choose at least two calendars above, then click Save selection. Run sync uses the saved list (not the checkboxes alone)."
                  : "Click Save selection to store your calendar choices. Run sync only works after at least two calendars are saved."}
              </p>
            ) : null}
          </section>

          {lastSync ? (
            <div className="border-t border-zinc-800/50 pt-6 text-sm">
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
                    lastSync.skipped.declinedByYou > 0 &&
                      `${lastSync.skipped.declinedByYou} declined by you`,
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
