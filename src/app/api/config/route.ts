import { NextRequest, NextResponse } from "next/server";
import { isStoreConnected, type CalendarWatchChannel } from "@/lib/store";
import { readStoreForUser, writeStoreForUser } from "@/lib/store-db";
import { listAllowedCalendarIds } from "@/lib/accounts";
import {
  calendarPushAvailable,
  registerWatchesForCalendars,
  stopAllWatchChannels,
} from "@/lib/calendar-watch";
import { performFullSyncCoalescedForUser } from "@/lib/run-sync-from-store";
import { requireUserId } from "@/lib/api-session";

export const runtime = "nodejs";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const s = await readStoreForUser(userId);
  if (!isStoreConnected(s)) {
    return NextResponse.json({ error: "not_connected" }, { status: 401 });
  }
  return NextResponse.json({ syncCalendarIds: s.syncCalendarIds ?? [] });
}

export async function PUT(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const s = await readStoreForUser(userId);
  if (!isStoreConnected(s)) {
    return NextResponse.json({ error: "not_connected" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const ids = (body as { syncCalendarIds?: unknown }).syncCalendarIds;
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) {
    return NextResponse.json({ error: "syncCalendarIds_required" }, { status: 400 });
  }
  const allowed = await listAllowedCalendarIds(s.accounts);
  for (const id of ids) {
    if (!allowed.has(id)) {
      return NextResponse.json(
        { error: "unknown_calendar", calendarId: id },
        { status: 400 }
      );
    }
  }

  await stopAllWatchChannels(s.accounts, s.calendarWatchChannels);

  let calendarWatchChannels: CalendarWatchChannel[] | undefined;
  if (calendarPushAvailable() && ids.length >= 2) {
    const registered = await registerWatchesForCalendars(s.accounts, ids);
    calendarWatchChannels = registered.length ? registered : undefined;
  }

  await writeStoreForUser(userId, {
    ...s,
    syncCalendarIds: ids,
    calendarWatchChannels,
  });

  void performFullSyncCoalescedForUser(userId);

  return NextResponse.json({
    ok: true,
    syncCalendarIds: ids,
    calendarPush: Boolean(calendarWatchChannels?.length),
  });
}
