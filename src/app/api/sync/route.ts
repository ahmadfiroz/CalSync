import { NextResponse } from "next/server";
import { isStoreConnected } from "@/lib/store";
import { readStoreForUser } from "@/lib/store-db";
import { requireUserId } from "@/lib/api-session";
import { performFullSyncForUser } from "@/lib/run-sync-from-store";

export const runtime = "nodejs";

export async function POST() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const s = await readStoreForUser(userId);
  if (!isStoreConnected(s)) {
    return NextResponse.json({ error: "not_connected" }, { status: 401 });
  }
  const ids = s.syncCalendarIds ?? [];
  if (ids.length < 2) {
    return NextResponse.json(
      { error: "need_two_calendars", message: "Select at least two calendars." },
      { status: 400 }
    );
  }

  const result = await performFullSyncForUser(userId);
  if (!result) {
    return NextResponse.json(
      { error: "sync_failed", message: "Could not run sync." },
      { status: 500 }
    );
  }
  return NextResponse.json(result);
}
