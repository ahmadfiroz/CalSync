import { randomUUID } from "crypto";
import type { calendar_v3 } from "@googleapis/calendar";
import type { CalendarWatchChannel, ConnectedAccount } from "./store";
import { getCalendarClient, publicBaseUrl } from "./google";
import { resolveClientForCalendar } from "./accounts";

function webhookAddress(): string | null {
  const base = publicBaseUrl();
  if (!base.startsWith("https://")) return null;
  if (/localhost|127\.0\.0\.1/i.test(base)) return null;
  return `${base}/api/webhooks/calendar`;
}

export function calendarPushAvailable(): boolean {
  return webhookAddress() !== null;
}

export async function stopWatchChannel(
  accounts: ConnectedAccount[],
  channelId: string,
  resourceId: string
): Promise<void> {
  for (const acc of accounts) {
    const cal = getCalendarClient(acc.refreshToken);
    try {
      await cal.channels.stop({
        requestBody: { id: channelId, resourceId },
      });
      return;
    } catch {
      continue;
    }
  }
}

export async function stopAllWatchChannels(
  accounts: ConnectedAccount[],
  channels: CalendarWatchChannel[] | undefined
): Promise<void> {
  for (const ch of channels ?? []) {
    await stopWatchChannel(accounts, ch.channelId, ch.resourceId);
  }
}

export async function registerWatchesForCalendars(
  accounts: ConnectedAccount[],
  calendarIds: string[]
): Promise<CalendarWatchChannel[]> {
  const address = webhookAddress();
  if (!address || calendarIds.length === 0) return [];

  const token = process.env.CALSYNC_WEBHOOK_TOKEN?.trim();
  const out: CalendarWatchChannel[] = [];

  for (const calendarId of calendarIds) {
    const cal = await resolveClientForCalendar(accounts, calendarId);
    if (!cal) continue;

    const channelId = randomUUID();
    const body: calendar_v3.Schema$Channel = {
      id: channelId,
      type: "web_hook",
      address,
      ...(token ? { token } : {}),
    };

    try {
      const res = await cal.events.watch({
        calendarId,
        requestBody: body,
      });
      const exp = res.data.expiration;
      const resourceId = res.data.resourceId;
      if (!resourceId || !exp) continue;
      out.push({
        calendarId,
        channelId,
        resourceId,
        expiration: String(exp),
      });
    } catch {
      continue;
    }
  }

  return out;
}

/**
 * If any channel expires within `renewWithinMs`, stops all and re-registers.
 * Returns `null` when nothing changed (no channels, or not yet expiring).
 */
export async function renewExpiringWatches(
  accounts: ConnectedAccount[],
  calendarIds: string[],
  channels: CalendarWatchChannel[] | undefined,
  renewWithinMs = 48 * 60 * 60 * 1000
): Promise<CalendarWatchChannel[] | null> {
  const list = channels ?? [];
  if (list.length === 0) return null;

  const now = Date.now();
  const needRenew = list.some((ch) => {
    const exp = Number(ch.expiration);
    return Number.isFinite(exp) && exp <= now + renewWithinMs;
  });

  if (!needRenew) return null;

  await stopAllWatchChannels(accounts, list);
  const next = await registerWatchesForCalendars(accounts, calendarIds);
  return next;
}
