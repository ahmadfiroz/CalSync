import { randomUUID } from "crypto";

export type ConnectedAccount = {
  id: string;
  refreshToken: string;
  email?: string;
};

export type MirrorRule = {
  id: string;
  /** Account ID whose calendars are the source. */
  sourceAccountId: string;
  /** Calendar IDs to read busy blocks from. */
  sourceCals: string[];
  /** Account ID that receives the mirror. */
  destAccountId: string;
  /** Calendar ID to write mirrors into, or "__auto__" to find/create "CalSync". */
  destCalId: string;
};

/** Google Calendar push channel (events.watch); renewed before expiry. */
export type CalendarWatchChannel = {
  calendarId: string;
  channelId: string;
  resourceId: string;
  /** Milliseconds since epoch as string (API `expiration`). */
  expiration: string;
};

export type CalSyncStore = {
  version: 3;
  accounts: ConnectedAccount[];
  mirrorRules: MirrorRule[];
  calendarWatchChannels?: CalendarWatchChannel[];
  /** Calendar ID to pre-select when creating a new event. */
  defaultCalendarId?: string;
};

export const EMPTY_STORE: CalSyncStore = {
  version: 3,
  accounts: [],
  mirrorRules: [],
};

function normalizeWatchChannels(
  raw: unknown
): CalendarWatchChannel[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CalendarWatchChannel[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const calendarId = typeof o.calendarId === "string" ? o.calendarId : "";
    const channelId = typeof o.channelId === "string" ? o.channelId : "";
    const resourceId = typeof o.resourceId === "string" ? o.resourceId : "";
    const expiration = typeof o.expiration === "string" ? o.expiration : "";
    if (calendarId && channelId && resourceId && expiration) {
      out.push({ calendarId, channelId, resourceId, expiration });
    }
  }
  return out.length ? out : undefined;
}

function normalizeMirrorRules(raw: unknown): MirrorRule[] {
  if (!Array.isArray(raw)) return [];
  const out: MirrorRule[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (
      typeof o.id !== "string" ||
      typeof o.sourceAccountId !== "string" ||
      typeof o.destAccountId !== "string" ||
      typeof o.destCalId !== "string" ||
      !Array.isArray(o.sourceCals)
    )
      continue;
    out.push({
      id: o.id,
      sourceAccountId: o.sourceAccountId,
      sourceCals: (o.sourceCals as unknown[]).filter(
        (c): c is string => typeof c === "string"
      ),
      destAccountId: o.destAccountId,
      destCalId: o.destCalId,
    });
  }
  return out;
}

function normalizeAccounts(raw: unknown[]): ConnectedAccount[] {
  return raw
    .filter(
      (a): a is ConnectedAccount =>
        Boolean(
          a &&
            typeof a === "object" &&
            typeof (a as ConnectedAccount).id === "string" &&
            typeof (a as ConnectedAccount).refreshToken === "string"
        )
    )
    .map((a) => ({
      id: a.id,
      refreshToken: a.refreshToken,
      email: typeof a.email === "string" ? a.email : undefined,
    }));
}

/** Normalize JSON (from DB or file) into a valid CalSyncStore. */
export function normalizeParsed(parsed: unknown): CalSyncStore {
  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;

    // v3
    if (p.version === 3 && Array.isArray(p.accounts)) {
      return {
        version: 3,
        accounts: normalizeAccounts(p.accounts as unknown[]),
        mirrorRules: normalizeMirrorRules(p.mirrorRules),
        calendarWatchChannels: normalizeWatchChannels(p.calendarWatchChannels),
        defaultCalendarId: typeof p.defaultCalendarId === "string" ? p.defaultCalendarId : undefined,
      };
    }

    // v2 → migrate: drop syncCalendarIds, start with empty rules
    if (p.version === 2 && Array.isArray(p.accounts)) {
      return {
        version: 3,
        accounts: normalizeAccounts(p.accounts as unknown[]),
        mirrorRules: [],
        calendarWatchChannels: normalizeWatchChannels(p.calendarWatchChannels),
      };
    }

    // old single-account format
    if (typeof p.refreshToken === "string") {
      return {
        version: 3,
        accounts: [
          {
            id: randomUUID(),
            refreshToken: p.refreshToken,
            email: typeof p.email === "string" ? p.email : undefined,
          },
        ],
        mirrorRules: [],
        calendarWatchChannels: undefined,
      };
    }
  }

  return { version: 3, accounts: [], mirrorRules: [] };
}

export function isStoreConnected(s: CalSyncStore | null): s is CalSyncStore {
  return s !== null && s.accounts.length > 0;
}
