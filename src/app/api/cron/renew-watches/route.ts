import { NextRequest, NextResponse } from "next/server";
import { readStoreForUser, writeStoreForUser, listUserIds } from "@/lib/store-db";
import { isStoreConnected } from "@/lib/store";
import {
  calendarPushAvailable,
  renewExpiringWatches,
} from "@/lib/calendar-watch";

export const runtime = "nodejs";

/**
 * Call periodically (e.g. daily) when deployed serverless so push channels
 * renew before Google’s ~7-day expiry. Requires CALSYNC_CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CALSYNC_CRON_SECRET?.trim();
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!calendarPushAvailable()) {
    return NextResponse.json({ ok: true, skipped: "no_https_public_url" });
  }

  const userIds = await listUserIds();
  let renewedAny = false;

  for (const userId of userIds) {
    const s = await readStoreForUser(userId);
    if (!isStoreConnected(s)) continue;

    const ids = s.syncCalendarIds ?? [];
    if (ids.length < 2) continue;

    const next = await renewExpiringWatches(
      s.accounts,
      ids,
      s.calendarWatchChannels
    );

    if (next === null) continue;

    await writeStoreForUser(userId, {
      ...s,
      calendarWatchChannels: next.length ? next : undefined,
    });
    renewedAny = true;
  }

  return NextResponse.json({
    ok: true,
    renewed: renewedAny,
    usersChecked: userIds.length,
  });
}
