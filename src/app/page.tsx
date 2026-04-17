"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SVGProps,
} from "react";

type Account = { id: string; email: string | null };

type Me = {
  connected: boolean;
  accounts?: Account[];
  email?: string | null;
};

type MirrorRule = {
  id: string;
  sourceAccountId: string;
  sourceCals: string[];
  destAccountId: string;
  destCalId: string;
};

type DraftRule = {
  sourceAccountId: string;
  sourceCals: Set<string>;
  destAccountId: string;
  destCalId: string;
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
  /** "accepted" | "declined" | "tentative" | "needsAction" | null (not an attendee) */
  selfRsvp?: string | null;
  /** Account ID that owns this calendar, needed for RSVP calls. */
  accountId?: string | null;
  /** Present when this event is an instance of a recurring series. */
  recurringEventId?: string | null;
  /** True for both master recurring events (recurrence[]) and expanded instances (recurringEventId). */
  isRecurring?: boolean;
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
/** Short timezone label, e.g. "GMT+8", "EST", "IST". */
function tzLabel(tz?: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZoneName: "short",
      timeZone: tz || undefined,
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return tz ?? "";
  }
}

function formatEventSchedule(ev: ListedEvent, tz?: string): string {
  const s = ev.start;
  const e = ev.end;
  if (!s) return "—";
  const tzOpt = tz ? { timeZone: tz } : {};

  if (s.date && !s.dateTime) {
    const sd = s.date;
    const ed = e?.date;
    if (!ed) {
      return parseGCalDate(sd).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...tzOpt,
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
        ...tzOpt,
      });
    }
    const endInclusive = new Date(edt);
    endInclusive.setDate(endInclusive.getDate() - 1);
    return `${sdt.toLocaleDateString(undefined, { month: "short", day: "numeric", ...tzOpt })} – ${endInclusive.toLocaleDateString(undefined, { month: "short", day: "numeric", ...tzOpt })}`;
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
      ...tzOpt,
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
      ...tzOpt,
    });
  }

  const sameDay = startOfLocalDay(start) === startOfLocalDay(end);
  const tfmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", ...tzOpt };
  const a = start.toLocaleTimeString(undefined, tfmt);
  const b = end.toLocaleTimeString(undefined, tfmt);

  if (sameDay) {
    if (datePrefix === "Today" || datePrefix === "Tomorrow") {
      return `${datePrefix} ${a}–${b}`;
    }
    return `${datePrefix} • ${a}–${b}`;
  }

  return `${start.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...tzOpt })} – ${end.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...tzOpt })}`;
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
      <rect x="2" y="6" width="13" height="12" rx="2" />
      <path d="M15 10l5.5-3v10l-5.5-3" />
    </svg>
  );
}

function IconMapPin(props: SVGProps<SVGSVGElement>) {
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
      <path d="M12 21C12 21 5 13.5 5 8.5a7 7 0 0 1 14 0c0 5-7 12.5-7 12.5z" />
      <circle cx="12" cy="8.5" r="2.5" />
    </svg>
  );
}

function isNavigationUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return (
      h.includes("maps.google") ||
      h.includes("goo.gl") ||
      h.includes("maps.apple") ||
      h.includes("waze.com") ||
      h.includes("bing.com")
    );
  } catch {
    return false;
  }
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
function formatEventTimeInDay(ev: ListedEvent, groupDayMs: number, tz?: string): string {
  const s = ev.start;
  const e = ev.end;
  if (!s) return "—";
  const tzOpt = tz ? { timeZone: tz } : {};

  if (s.date && !s.dateTime) {
    const sd = s.date;
    const ed = e?.date;
    const sdt = parseGCalDate(sd);
    const start0 = startOfLocalDay(sdt);
    if (!ed) {
      return start0 === groupDayMs
        ? "All day"
        : sdt.toLocaleDateString(undefined, { month: "short", day: "numeric", ...tzOpt });
    }
    const edt = parseGCalDate(ed);
    const dayMs = 86_400_000;
    const span = edt.getTime() - sdt.getTime();
    if (span <= dayMs) {
      return start0 === groupDayMs
        ? "All day"
        : sdt.toLocaleDateString(undefined, { month: "short", day: "numeric", ...tzOpt });
    }
    const endInclusive = new Date(edt);
    endInclusive.setDate(endInclusive.getDate() - 1);
    return `${sdt.toLocaleDateString(undefined, { month: "short", day: "numeric", ...tzOpt })} – ${endInclusive.toLocaleDateString(undefined, { month: "short", day: "numeric", ...tzOpt })}`;
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
      ...tzOpt,
    });
  }
  const sameDay = startOfLocalDay(start) === startOfLocalDay(end);
  const tfmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", ...tzOpt };
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
        ...tzOpt,
      });
    }
    if (datePrefix === "Today" || datePrefix === "Tomorrow") {
      return `${datePrefix} ${a}–${b}`;
    }
    return `${datePrefix} • ${a}–${b}`;
  }
  return `${start.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...tzOpt })} – ${end.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...tzOpt })}`;
}

function joinMeetingLabel(url: string): string {
  if (isNavigationUrl(url)) return "Navigate";
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h.includes("meet.google")) return "Join Google Meet";
    if (h.includes("zoom.us")) return "Join Zoom";
    if (h.includes("teams.microsoft")) return "Join Teams";
    if (h.includes("webex.com")) return "Join Webex";
  } catch {
    /* ignore */
  }
  return "Join meeting";
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
}: {
  url: string;
  mutedOutline?: boolean;
}) {
  const label = joinMeetingLabel(url);
  const isNav = isNavigationUrl(url);
  const icon = isNav ? (
    <IconMapPin className="h-3.5 w-3.5 shrink-0" />
  ) : (
    <IconVideo className="h-3.5 w-3.5 shrink-0" />
  );

  if (mutedOutline) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-600/80 bg-transparent px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
      >
        {icon}
        {label}
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-sky-600/90 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
    >
      {icon}
      {label}
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

function tzOffsetLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    // "GMT+08:00" → "UTC+8", "GMT-05:00" → "UTC-5", "GMT" → "UTC"
    return raw.replace("GMT", "UTC").replace(/:00$/, "").replace(/:30$/, ":30").replace(/:45$/, ":45");
  } catch {
    return "";
  }
}

function tzDisplayName(tz: string): string {
  const short = tzLabel(tz);
  const offset = tzOffsetLabel(tz);
  const city = tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
  return offset ? `${city} — ${short} (${offset})` : `${city} — ${short}`;
}

function TimezoneCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (tz: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allZones = useMemo<string[]>(() => {
    try {
      return Intl.supportedValuesOf("timeZone") as string[];
    } catch {
      return [];
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allZones.slice(0, 80);
    return allZones
      .filter(
        (tz) =>
          tz.toLowerCase().includes(q) ||
          tzLabel(tz).toLowerCase().includes(q) ||
          tzOffsetLabel(tz).toLowerCase().includes(q)
      )
      .slice(0, 80);
  }, [query, allZones]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const displayValue = value ? tzDisplayName(value) : "";

  return (
    <div ref={containerRef} className="relative inline-flex flex-col gap-1">
      <label className="text-xs font-medium text-zinc-400">Add timezone</label>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          placeholder={value ? displayValue : "Search timezone…"}
          value={open ? query : displayValue}
          onFocus={() => { setOpen(true); setQuery(""); }}
          onChange={(e) => setQuery(e.target.value)}
          className="w-56 rounded-md border border-zinc-800/50 bg-transparent py-2 pl-3 pr-8 text-sm text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
        />
        {value ? (
          <button
            type="button"
            onClick={() => { onChange(""); setQuery(""); setOpen(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300"
            title="Clear"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        )}
      </div>
      {open && (
        <ul className="absolute left-0 top-full z-50 mt-1 max-h-60 w-72 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 py-1 shadow-xl">
          <li>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(""); setOpen(false); setQuery(""); }}
              className={`w-full px-3 py-2 text-left text-sm ${!value ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"}`}
            >
              Local time
            </button>
          </li>
          {filtered.map((tz) => (
            <li key={tz}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onChange(tz); setOpen(false); setQuery(""); }}
                className={`w-full px-3 py-2 text-left text-sm ${value === tz ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"}`}
              >
                <span className="block truncate">{tzDisplayName(tz)}</span>
                <span className="block truncate text-[11px] text-zinc-600">{tz}</span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-zinc-600">No timezones found</li>
          )}
        </ul>
      )}
    </div>
  );
}

function AgendaEventRow({
  ev,
  groupDayMs,
  isListHead,
  now,
  declinedHidden,
  isFirstInAgenda,
  viewTimezone,
  onRsvp,
}: {
  ev: ListedEvent;
  groupDayMs?: number;
  isListHead: boolean;
  now: Date | null;
  declinedHidden: boolean;
  isFirstInAgenda: boolean;
  viewTimezone?: string;
  onRsvp?: (calendarId: string, eventId: string, accountId: string, response: "accepted" | "declined" | "tentative", scope: "this" | "following" | "all", recurringEventId?: string, eventStartTime?: string) => void;
}) {
  const [pendingResponse, setPendingResponse] = useState<"accepted" | "declined" | "tentative" | null>(null);
  const isTimed = Boolean(ev.start?.dateTime);
  const localTzLabel = isTimed ? tzLabel() : "";
  const altTzLabel = isTimed && viewTimezone ? tzLabel(viewTimezone) : "";
  const showAltTz = Boolean(viewTimezone && altTzLabel && altTzLabel !== localTzLabel);

  const timeLabel =
    groupDayMs != null
      ? formatEventTimeInDay(ev, groupDayMs)
      : formatEventSchedule(ev);
  const altTimeLabel = showAltTz
    ? groupDayMs != null
      ? formatEventTimeInDay(ev, groupDayMs, viewTimezone)
      : formatEventSchedule(ev, viewTimezone)
    : null;
  const headStatus = isListHead && now ? computeListHeadStatus(ev, now) : null;
  const declined = Boolean(ev.declinedBySelf);
  const isPending = ev.selfRsvp === "needsAction";
  const muted = declined;

  const inner = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <EventTitle ev={ev} muted={muted} />
          {declined ? (
            <span className="inline-flex shrink-0 items-center rounded-full border border-zinc-600/60 bg-zinc-900/40 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
              Declined
            </span>
          ) : null}
          {isPending ? (
            <span className="inline-flex shrink-0 items-center rounded-full border border-amber-700/50 bg-amber-950/40 px-2 py-0.5 text-[11px] font-medium text-amber-400/90">
              Invited
            </span>
          ) : null}
          {headStatus ? (
            <ListHeadTag status={headStatus} muted={muted} />
          ) : null}
        </div>
        <div
          className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${muted ? "text-zinc-600" : "text-zinc-500"}`}
        >
          <span className="inline-flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1.5">
              <IconClock
                className={`h-3.5 w-3.5 shrink-0 ${muted ? "text-zinc-700" : "text-zinc-600"}`}
              />
              <span className={muted ? "text-zinc-500" : "text-zinc-400"}>
                {timeLabel}{localTzLabel ? ` (${localTzLabel})` : ""}
              </span>
            </span>
            {showAltTz && altTimeLabel ? (
              <span className="ml-5 inline-flex items-center gap-1 text-[11px] text-zinc-600">
                <span>{altTimeLabel}{altTzLabel ? ` (${altTzLabel})` : ""}</span>
              </span>
            ) : null}
          </span>
          <span className={muted ? "text-zinc-700" : "text-zinc-600"}>·</span>
          <span
            className={`inline-flex max-w-full items-center gap-1.5 text-[11px] ${muted ? "text-zinc-600" : "text-zinc-500"}`}
            title={ev.calendarSummary}
          >
            <IconCalendar
              className={`h-3 w-3 shrink-0 ${muted ? "text-zinc-700" : "text-zinc-600"}`}
            />
            <span className="truncate">{ev.calendarSummary}</span>
          </span>
        </div>
        {showAccountEmailBelow(ev) ? (
          <p
            className={`text-[11px] ${muted ? "text-zinc-600/90" : "text-zinc-600"}`}
          >
            {ev.accountEmail ?? "Google account"}
          </p>
        ) : null}
        {ev.selfRsvp != null && ev.id && ev.accountId && onRsvp ? (
          <div className="flex flex-col items-start gap-1">
            <div className="inline-flex items-center gap-0.5 rounded-md border border-zinc-800/60 bg-zinc-900/30 p-0.5">
              {(
                [
                  { r: "accepted", label: "Yes", active: "bg-emerald-800/60 text-emerald-300" },
                  { r: "tentative", label: "Maybe", active: "bg-zinc-700/60 text-zinc-200" },
                  { r: "declined", label: "No", active: "bg-red-900/50 text-red-400" },
                ] as const
              ).map(({ r, label, active }) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    if (ev.isRecurring) {
                      setPendingResponse(pendingResponse === r ? null : r);
                    } else {
                      onRsvp(ev.calendarId, ev.id!, ev.accountId!, r, "this");
                    }
                  }}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                    ev.selfRsvp === r
                      ? active
                      : pendingResponse === r
                        ? "bg-zinc-800 text-zinc-200"
                        : "text-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {pendingResponse && ev.isRecurring ? (
              <div className="inline-flex flex-wrap items-center gap-1 rounded border border-zinc-800/60 bg-zinc-900/60 px-1.5 py-1">
                <span className="mr-0.5 text-[10px] text-zinc-500">Apply to:</span>
                <button
                  type="button"
                  onClick={() => {
                    onRsvp(ev.calendarId, ev.id!, ev.accountId!, pendingResponse, "this");
                    setPendingResponse(null);
                  }}
                  className="rounded px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700/60"
                >
                  This event
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const masterId = ev.recurringEventId ?? ev.id!;
                    const startTime = ev.start?.dateTime ?? ev.start?.date ?? undefined;
                    onRsvp(ev.calendarId, ev.id!, ev.accountId!, pendingResponse, "following", masterId, startTime);
                    setPendingResponse(null);
                  }}
                  className="rounded px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700/60"
                >
                  This and following
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const masterId = ev.recurringEventId ?? ev.id!;
                    onRsvp(ev.calendarId, ev.id!, ev.accountId!, pendingResponse, "all", masterId);
                    setPendingResponse(null);
                  }}
                  className="rounded px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700/60"
                >
                  All events
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:items-end">
        {ev.meetingUrl ? (
          <MeetingJoinLink url={ev.meetingUrl} mutedOutline={muted} />
        ) : null}
      </div>
    </div>
  );

  const padY = isFirstInAgenda ? "pt-0 pb-5 sm:pb-5" : "py-5";

  if (!declined) {
    return (
      <li
        className={`border-b border-zinc-800/50 ${padY} motion-reduce:transition-none${isPending ? " border-l-2 border-l-amber-600/60 pl-3" : ""}`}
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
          : "grid-rows-[1fr] border-b"
      }`}
      aria-hidden={declinedHidden}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={`${padY} transition-opacity duration-200 ease-out motion-reduce:transition-none ${
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
          className={`flex h-8 w-14 shrink-0 items-center rounded-full border p-1 transition-colors duration-200 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none ${
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
  const [mirrorRules, setMirrorRules] = useState<MirrorRule[]>([]);
  const [draftRule, setDraftRule] = useState<Partial<DraftRule> | null>(null);
  const [draftStep, setDraftStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
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
  const [viewTimezone, setViewTimezone] = useState<string>(""); // "" = local
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsErr, setEventsErr] = useState<string | null>(null);
  const [eventsRows, setEventsRows] = useState<ListedEvent[]>([]);
  const [eventsLoadWarnings, setEventsLoadWarnings] = useState<string[]>([]);
  const [staleAccounts, setStaleAccounts] = useState<string[]>([]);
  const [clearMirrorsBusy, setClearMirrorsBusy] = useState<string | null>(null);
  const [clearMirrorsNote, setClearMirrorsNote] = useState<string | null>(null);

  // Create event modal
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [createEventBusy, setCreateEventBusy] = useState(false);
  const [createEventErr, setCreateEventErr] = useState<string | null>(null);
  const [createEventForm, setCreateEventForm] = useState<{
    title: string;
    calendarId: string;
    accountId: string;
    date: string;
    startTime: string;
    endTime: string;
    allDay: boolean;
    description: string;
    location: string;
  }>({
    title: "",
    calendarId: "",
    accountId: "",
    date: "",
    startTime: "09:00",
    endTime: "10:00",
    allDay: false,
    description: "",
    location: "",
  });

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
        setMirrorRules([]);
        return;
      }
      const [cr, cfgr] = await Promise.all([
        fetch("/api/calendars"),
        fetch("/api/config"),
      ]);
      const calBody = await cr.text();
      let cj: { calendars?: Cal[]; staleAccounts?: string[]; error?: string; message?: string } = {};
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
      const fetchedCalendars = cj.calendars ?? [];
      setCalendars(fetchedCalendars);
      if (cj.staleAccounts?.length) setStaleAccounts(cj.staleAccounts);
      if (cfgr.ok) {
        const cfg = (await cfgr.json()) as { mirrorRules?: MirrorRule[] };
        const rawRules = cfg.mirrorRules ?? [];
        const accounts = m.accounts ?? [];

        // Auto-heal rules whose sourceAccountId/destAccountId became stale
        // (e.g. after re-auth generated a new UUID). Infer correct account
        // from which account currently owns the referenced calendars.
        const healedRules = rawRules.map((rule) => {
          const srcOk = accounts.some((a) => a.id === rule.sourceAccountId);
          const dstOk = accounts.some((a) => a.id === rule.destAccountId);
          if (srcOk && dstOk) return rule;

          let newSourceId = rule.sourceAccountId;
          if (!srcOk) {
            for (const calId of rule.sourceCals) {
              const ownerAccountId = fetchedCalendars.find((c) => c.id === calId)?.accountId;
              if (ownerAccountId && accounts.some((a) => a.id === ownerAccountId)) {
                newSourceId = ownerAccountId;
                break;
              }
            }
          }

          let newDestId = rule.destAccountId;
          if (!dstOk && rule.destCalId !== "__auto__") {
            const ownerAccountId = fetchedCalendars.find((c) => c.id === rule.destCalId)?.accountId;
            if (ownerAccountId && accounts.some((a) => a.id === ownerAccountId)) {
              newDestId = ownerAccountId;
            }
          }

          return { ...rule, sourceAccountId: newSourceId, destAccountId: newDestId };
        });

        setMirrorRules(healedRules);

        // Silently persist healed rules if any IDs changed
        if (healedRules.some((r, i) => r !== rawRules[i])) {
          void fetch("/api/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mirrorRules: healedRules }),
          });
        }
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
    if (e) setUrlError(e);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userMenuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [userMenuOpen]);

  const canSync = mirrorRules.some((r) => r.sourceCals.length > 0);

  const rulesKey = useMemo(
    () => mirrorRules.map((r) => r.id).join("\0"),
    [mirrorRules]
  );
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
          staleAccounts?: string[];
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
        setStaleAccounts(j.staleAccounts ?? []);
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
  const [agendaNow, setAgendaNow] = useState<Date | null>(null);
  useEffect(() => {
    setAgendaNow(new Date());
  }, [eventsNowTick]);

  const visibleEventRows = useMemo(
    () => agendaNow ? eventsRows.filter((ev) => !eventHasEnded(ev, agendaNow)) : eventsRows,
    [eventsRows, agendaNow]
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
  }, [dashTab, eventsDays, me?.connected, rulesKey, loadEvents]);

  useEffect(() => {
    if (dashTab !== "events" || !me?.connected) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadEvents({ silent: true });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [dashTab, me?.connected, loadEvents]);

  const saveConfig = async () => {
    setSaveBusy(true);
    setLastSync(null);
    try {
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mirrorRules }),
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

  const startDraftRule = () => {
    setDraftRule({});
    setDraftStep(1);
  };

  const cancelDraft = () => {
    setDraftRule(null);
  };

  const commitDraftRule = () => {
    if (
      !draftRule?.sourceAccountId ||
      !draftRule.sourceCals?.size ||
      !draftRule.destAccountId
    )
      return;
    const newRule: MirrorRule = {
      id: crypto.randomUUID(),
      sourceAccountId: draftRule.sourceAccountId,
      sourceCals: Array.from(draftRule.sourceCals),
      destAccountId: draftRule.destAccountId,
      destCalId: draftRule.destCalId || "__auto__",
    };
    setMirrorRules((prev) => [...prev, newRule]);
    setDraftRule(null);
  };

  const removeRule = (id: string) => {
    setMirrorRules((prev) => prev.filter((r) => r.id !== id));
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

  const openCreateEvent = () => {
    const today = new Date().toISOString().slice(0, 10);
    setCreateEventForm((f) => ({ ...f, date: today, title: "", description: "", location: "" }));
    setCreateEventErr(null);
    setCreateEventOpen(true);
  };

  const submitCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateEventErr(null);
    setCreateEventBusy(true);
    try {
      const { title, calendarId, accountId, date, startTime, endTime, allDay, description, location } = createEventForm;
      const start = allDay ? date : `${date}T${startTime}:00`;
      const end = allDay ? date : `${date}T${endTime}:00`;
      const r = await fetch("/api/events/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, calendarId, accountId, start, end, allDay, description, location }),
      });
      const j = await r.json() as { ok?: boolean; error?: string; message?: string };
      if (!r.ok) throw new Error(j.message || j.error || "Failed to create event");
      setCreateEventOpen(false);
      void loadEvents({ silent: true });
    } catch (err) {
      setCreateEventErr(err instanceof Error ? err.message : String(err));
    } finally {
      setCreateEventBusy(false);
    }
  };

  const handleRsvp = useCallback(
    async (
      calendarId: string,
      eventId: string,
      accountId: string,
      response: "accepted" | "declined" | "tentative",
      scope: "this" | "following" | "all",
      recurringEventId?: string,
      eventStartTime?: string
    ) => {
      // Optimistic update
      setEventsRows((rows) =>
        rows.map((r) => {
          let matches = false;
          if (scope === "all" && recurringEventId) {
            matches = r.calendarId === calendarId &&
              (r.recurringEventId === recurringEventId || r.id === recurringEventId);
          } else if (scope === "following" && recurringEventId && eventStartTime) {
            const thisStart = new Date(eventStartTime).getTime();
            const rStart = new Date(r.start?.dateTime ?? r.start?.date ?? 0).getTime();
            matches = r.calendarId === calendarId &&
              (r.recurringEventId === recurringEventId || r.id === recurringEventId) &&
              rStart >= thisStart;
          } else {
            matches = r.id === eventId && r.calendarId === calendarId;
          }
          return matches
            ? { ...r, selfRsvp: response, declinedBySelf: response === "declined" }
            : r;
        })
      );
      try {
        const res = await fetch("/api/events/rsvp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ calendarId, eventId, accountId, response, scope, recurringEventId, eventStartTime }),
        });
        const j = await res.json() as { ok?: boolean; error?: string; message?: string };
        if (!res.ok) throw new Error(j.message || j.error || "RSVP failed");
      } catch (err) {
        console.error("[CalSync] RSVP error:", err);
        void loadEvents({ silent: true });
      }
    },
    [loadEvents]
  );

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
          {!loading && me?.email ? (
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-full focus:outline-none"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-sm font-semibold text-white">
                  {me.email[0]?.toUpperCase() ?? "?"}
                </span>
                <span className="hidden max-w-[12rem] truncate text-sm text-zinc-300 sm:block">
                  {me.email}
                </span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-zinc-500">
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
              {userMenuOpen ? (
                <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-zinc-800 bg-zinc-950 py-1 shadow-xl">
                  <div className="border-b border-zinc-800 px-4 py-2.5">
                    <p className="truncate text-sm font-medium text-zinc-100">{me.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setUserMenuOpen(false); void signOutDashboard(); }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {staleAccounts.length > 0 ? (
        <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm">
          <p className="font-medium text-amber-300">
            Google session expired: {staleAccounts.join(", ")}
          </p>
          <p className="mt-0.5 text-xs text-amber-200/70">
            Go to{" "}
            <button
              type="button"
              onClick={() => setDashTab("sync")}
              className="underline underline-offset-2 hover:text-amber-100"
            >
              Sync Setup
            </button>{" "}
            and use <strong>Add another Google account</strong> to re-connect.
          </p>
        </div>
      ) : displayError ? (
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
            className="flex gap-8 border-b border-zinc-800/50 text-sm"
            role="tablist"
            aria-label="Dashboard sections"
          >
            <button
              type="button"
              role="tab"
              aria-selected={dashTab === "events"}
              onClick={() => setDashTab("events")}
              className={`-mb-px border-b-2 pb-3 font-medium transition-colors ${
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
              className={`-mb-px border-b-2 pb-3 font-medium transition-colors ${
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
              <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-6 gap-y-3">
                <label className="inline-flex w-full max-w-xs flex-col gap-1">
                  <span className="text-xs font-medium text-zinc-400">
                    Time range
                  </span>
                  <select
                    value={eventsDays}
                    onChange={(e) => setEventsDays(Number(e.target.value))}
                    className="min-w-[11rem] appearance-none rounded-md border border-zinc-800/50 bg-transparent py-2 pl-3 pr-10 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
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
                <TimezoneCombobox value={viewTimezone} onChange={setViewTimezone} />
              </div>
              {me?.connected ? (
                <button
                  type="button"
                  onClick={openCreateEvent}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-sky-600/90 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-3.5 w-3.5"><path d="M12 5v14M5 12h14"/></svg>
                  New Event
                </button>
              ) : null}
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
                    ? mirrorRules.length === 0
                      ? "No mirror rules configured. Open Settings, add a rule, and click Save."
                      : 'No events in this range for your selected calendars (or only cancelled or "free" items were returned).'
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
                            viewTimezone={viewTimezone || undefined}
                            onRsvp={handleRsvp}
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
                            viewTimezone={viewTimezone || undefined}
                            onRsvp={handleRsvp}
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
                className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
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

          <section className="space-y-4 border-t border-zinc-800/50 pt-8">
            <div>
              <h2 className="text-sm font-medium text-zinc-200">Mirror rules</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Each rule reads busy times from a source account and writes them
                into a CalSync calendar on the destination account.
              </p>
            </div>

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

            {/* Existing rules */}
            {mirrorRules.length > 0 && (
              <div className="space-y-3">
                {mirrorRules.map((rule) => {
                  const srcAccount = me?.accounts?.find(
                    (a) => a.id === rule.sourceAccountId
                  );
                  const dstAccount = me?.accounts?.find(
                    (a) => a.id === rule.destAccountId
                  );
                  const destCalLabel =
                    rule.destCalId === "__auto__"
                      ? "CalSync (auto-create)"
                      : (calendars.find((c) => c.id === rule.destCalId)
                          ?.summary ?? rule.destCalId);

                  return (
                    <div
                      key={rule.id}
                      className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-2">
                          {/* Source */}
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 mb-1">
                              From
                            </p>
                            <p className="text-xs font-medium text-zinc-300">
                              {srcAccount?.email ?? rule.sourceAccountId}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {rule.sourceCals.map((calId) => {
                                const cal = calendars.find(
                                  (c) => c.id === calId
                                );
                                return (
                                  <span
                                    key={calId}
                                    className="inline-block rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300"
                                  >
                                    {cal?.summary ?? calId}
                                  </span>
                                );
                              })}
                            </div>
                          </div>

                          {/* Arrow */}
                          <div className="text-zinc-600 text-xs pl-0.5">↓</div>

                          {/* Destination */}
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 mb-1">
                              To
                            </p>
                            <p className="text-xs font-medium text-zinc-300">
                              {dstAccount?.email ?? rule.destAccountId}
                            </p>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="inline-block rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">
                                {destCalLabel}
                              </span>
                              {rule.destCalId !== "__auto__" && (
                                <button
                                  type="button"
                                  disabled={clearMirrorsBusy === rule.destCalId}
                                  onClick={() => {
                                    void clearMirrorsForCalendar(
                                      rule.destCalId,
                                      destCalLabel
                                    );
                                  }}
                                  className="text-[11px] text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline disabled:opacity-50"
                                >
                                  {clearMirrorsBusy === rule.destCalId
                                    ? "Clearing…"
                                    : "Clear mirrors"}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeRule(rule.id)}
                          className="shrink-0 text-xs text-zinc-600 underline-offset-4 hover:text-zinc-400 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Draft rule wizard */}
            {draftRule !== null ? (
              <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-4 space-y-4">
                <p className="text-xs font-semibold text-zinc-200">
                  New mirror rule
                </p>

                {draftStep === 1 && (
                  <div className="space-y-3">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                      Step 1 of 3 — Source account
                    </p>
                    <ul className="space-y-2">
                      {(me?.accounts ?? []).map((acc) => (
                        <li key={acc.id}>
                          <label className="flex cursor-pointer items-center gap-3">
                            <input
                              type="radio"
                              name="draftSrcAccount"
                              value={acc.id}
                              checked={draftRule.sourceAccountId === acc.id}
                              onChange={() =>
                                setDraftRule((r) => ({
                                  ...r,
                                  sourceAccountId: acc.id,
                                  sourceCals: new Set(),
                                }))
                              }
                            />
                            <span className="text-sm text-zinc-100">
                              {acc.email ?? acc.id}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={cancelDraft}
                        className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!draftRule.sourceAccountId}
                        onClick={() => setDraftStep(2)}
                        className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-600 disabled:opacity-40"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                )}

                {draftStep === 2 && (
                  <div className="space-y-3">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                      Step 2 of 3 — Calendars to mirror
                    </p>
                    <p className="text-xs text-zinc-400">
                      From{" "}
                      {me?.accounts?.find(
                        (a) => a.id === draftRule.sourceAccountId
                      )?.email ?? draftRule.sourceAccountId}
                    </p>
                    {(() => {
                      const sourceCals = calendars.filter(
                        (c) =>
                          c.accountId === draftRule.sourceAccountId &&
                          c.summary !== "CalSync"
                      );
                      const allIds = sourceCals.map((c) => c.id);
                      const checkedCount = allIds.filter(
                        (id) => draftRule.sourceCals?.has(id)
                      ).length;
                      const allChecked = checkedCount === allIds.length && allIds.length > 0;
                      const someChecked = checkedCount > 0 && !allChecked;
                      return (
                        <>
                          <label className="flex cursor-pointer items-center gap-3 border-b border-zinc-800 pb-2">
                            <input
                              type="checkbox"
                              checked={allChecked}
                              ref={(el) => {
                                if (el) el.indeterminate = someChecked;
                              }}
                              onChange={() =>
                                setDraftRule((r) => ({
                                  ...r,
                                  sourceCals: allChecked
                                    ? new Set()
                                    : new Set(allIds),
                                }))
                              }
                            />
                            <span className="text-xs font-medium text-zinc-400">
                              Select all
                            </span>
                          </label>
                          <ul className="space-y-2">
                            {sourceCals.map((c) => (
                              <li key={c.id}>
                                <label className="flex cursor-pointer items-center gap-3">
                                  <input
                                    type="checkbox"
                                    checked={
                                      draftRule.sourceCals?.has(c.id) ?? false
                                    }
                                    onChange={() =>
                                      setDraftRule((r) => {
                                        const s = new Set(r?.sourceCals ?? []);
                                        if (s.has(c.id)) s.delete(c.id);
                                        else s.add(c.id);
                                        return { ...r, sourceCals: s };
                                      })
                                    }
                                  />
                                  <span className="text-sm text-zinc-100">
                                    {c.summary}
                                  </span>
                                  {c.primary ? (
                                    <span className="text-xs text-amber-400/90">
                                      primary
                                    </span>
                                  ) : null}
                                </label>
                              </li>
                            ))}
                          </ul>
                        </>
                      );
                    })()}
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setDraftStep(1)}
                        className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
                      >
                        ← Back
                      </button>
                      <button
                        type="button"
                        disabled={!(draftRule.sourceCals?.size)}
                        onClick={() => setDraftStep(3)}
                        className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-600 disabled:opacity-40"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                )}

                {draftStep === 3 && (
                  <div className="space-y-3">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                      Step 3 of 3 — Destination
                    </p>
                    <div className="space-y-3">
                      <div>
                        <p className="mb-1 text-xs text-zinc-400">
                          Destination account
                        </p>
                        <select
                          value={draftRule.destAccountId ?? ""}
                          onChange={(e) =>
                            setDraftRule((r) => ({
                              ...r,
                              destAccountId: e.target.value,
                              destCalId: "__auto__",
                            }))
                          }
                          className="appearance-none rounded-md border border-zinc-700 bg-zinc-800 py-1.5 pl-3 pr-8 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
                          style={{
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2020/svg' fill='none' viewBox='0 0 24 24' stroke='%23a1a1aa' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                            backgroundSize: "1rem",
                            backgroundPosition: "right 0.5rem center",
                            backgroundRepeat: "no-repeat",
                          }}
                        >
                          <option value="">Pick an account…</option>
                          {(me?.accounts ?? [])
                            .filter(
                              (a) => a.id !== draftRule.sourceAccountId
                            )
                            .map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.email ?? acc.id}
                              </option>
                            ))}
                        </select>
                      </div>

                      {draftRule.destAccountId && (
                        <div>
                          <p className="mb-1 text-xs text-zinc-400">
                            Destination calendar
                          </p>
                          <select
                            value={draftRule.destCalId ?? "__auto__"}
                            onChange={(e) =>
                              setDraftRule((r) => ({
                                ...r,
                                destCalId: e.target.value,
                              }))
                            }
                            className="appearance-none rounded-md border border-zinc-700 bg-zinc-800 py-1.5 pl-3 pr-8 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
                            style={{
                              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2020/svg' fill='none' viewBox='0 0 24 24' stroke='%23a1a1aa' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                              backgroundSize: "1rem",
                              backgroundPosition: "right 0.5rem center",
                              backgroundRepeat: "no-repeat",
                            }}
                          >
                            <option value="__auto__">
                              CalSync (auto-create)
                            </option>
                            {calendars
                              .filter(
                                (c) => c.accountId === draftRule.destAccountId
                              )
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.summary}
                                </option>
                              ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setDraftStep(2)}
                        className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
                      >
                        ← Back
                      </button>
                      <button
                        type="button"
                        disabled={!draftRule.destAccountId}
                        onClick={commitDraftRule}
                        className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
                      >
                        Add rule
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={startDraftRule}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-4 py-2.5 text-xs font-medium text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              >
                <span>+</span> Add mirror rule
              </button>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                disabled={saveBusy}
                onClick={() => void saveConfig()}
                className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
              >
                {saveBusy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={syncing || !canSync}
                onClick={() => void runSync()}
                className="rounded-lg border border-zinc-600 bg-transparent px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-40"
              >
                {syncing ? "Syncing…" : "Run sync now"}
              </button>
            </div>
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
      {/* Create Event Modal */}
      {createEventOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setCreateEventOpen(false); }}
        >
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-zinc-100">New Event</h2>
              <button
                type="button"
                onClick={() => setCreateEventOpen(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <form onSubmit={submitCreateEvent} className="space-y-4">
              {/* Title */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-400">Title</label>
                <input
                  type="text"
                  required
                  placeholder="Event title"
                  value={createEventForm.title}
                  onChange={(e) => setCreateEventForm((f) => ({ ...f, title: e.target.value }))}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              {/* Calendar */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-400">Calendar</label>
                <select
                  required
                  value={createEventForm.calendarId}
                  onChange={(e) => {
                    const cal = calendars.find((c) => c.id === e.target.value);
                    setCreateEventForm((f) => ({
                      ...f,
                      calendarId: e.target.value,
                      accountId: cal?.accountId ?? f.accountId,
                    }));
                  }}
                  className="appearance-none rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23a1a1aa' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                    backgroundSize: "1.125rem",
                    backgroundPosition: "right 0.65rem center",
                    backgroundRepeat: "no-repeat",
                    paddingRight: "2.25rem",
                  }}
                >
                  <option value="" disabled>Select a calendar</option>
                  {me?.accounts?.map((acc) => {
                    const accCals = calendars.filter((c) => c.accountId === acc.id && c.summary !== "CalSync");
                    if (!accCals.length) return null;
                    return (
                      <optgroup key={acc.id} label={acc.email ?? acc.id}>
                        {accCals.map((c) => (
                          <option key={c.id} value={c.id}>{c.summary}{c.primary ? " (primary)" : ""}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>

              {/* All day toggle + date */}
              <div className="flex items-center gap-4">
                <div className="flex flex-1 flex-col gap-1">
                  <label className="text-xs font-medium text-zinc-400">Date</label>
                  <input
                    type="date"
                    required
                    value={createEventForm.date}
                    onChange={(e) => setCreateEventForm((f) => ({ ...f, date: e.target.value }))}
                    className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
                  />
                </div>
                <label className="mt-5 flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={createEventForm.allDay}
                    onChange={(e) => setCreateEventForm((f) => ({ ...f, allDay: e.target.checked }))}
                  />
                  All day
                </label>
              </div>

              {/* Time range */}
              {!createEventForm.allDay && (
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-xs font-medium text-zinc-400">Start time</label>
                    <input
                      type="time"
                      required
                      value={createEventForm.startTime}
                      onChange={(e) => setCreateEventForm((f) => ({ ...f, startTime: e.target.value }))}
                      className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-xs font-medium text-zinc-400">End time</label>
                    <input
                      type="time"
                      required
                      value={createEventForm.endTime}
                      onChange={(e) => setCreateEventForm((f) => ({ ...f, endTime: e.target.value }))}
                      className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Location */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-400">Location <span className="text-zinc-600">(optional)</span></label>
                <input
                  type="text"
                  placeholder="Add location"
                  value={createEventForm.location}
                  onChange={(e) => setCreateEventForm((f) => ({ ...f, location: e.target.value }))}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-400">Description <span className="text-zinc-600">(optional)</span></label>
                <textarea
                  rows={2}
                  placeholder="Add description"
                  value={createEventForm.description}
                  onChange={(e) => setCreateEventForm((f) => ({ ...f, description: e.target.value }))}
                  className="resize-none rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              {createEventErr ? (
                <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-200">{createEventErr}</p>
              ) : null}

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setCreateEventOpen(false)}
                  className="px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createEventBusy}
                  className="rounded-md bg-sky-600/90 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                >
                  {createEventBusy ? "Creating…" : "Create Event"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
