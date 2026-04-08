import { NextRequest, NextResponse } from "next/server";
import { resolveUserIdByChannelId } from "@/lib/store-db";
import { performFullSyncCoalescedForUser } from "@/lib/run-sync-from-store";

export const runtime = "nodejs";

const debounceByUser = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleSyncForUser(userId: string) {
  const prev = debounceByUser.get(userId);
  if (prev) clearTimeout(prev);
  debounceByUser.set(
    userId,
    setTimeout(() => {
      debounceByUser.delete(userId);
      void performFullSyncCoalescedForUser(userId);
    }, 2500)
  );
}

/**
 * Google Calendar push notifications (events.watch).
 * @see https://developers.google.com/calendar/api/guides/push
 */
export async function POST(req: NextRequest) {
  const expected = process.env.CALSYNC_WEBHOOK_TOKEN?.trim();
  if (expected) {
    const got = req.headers.get("x-goog-channel-token");
    if (got !== expected) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const state = req.headers.get("x-goog-resource-state");
  if (state === "sync" || state === "exists" || state === "not_exists") {
    const channelId = req.headers.get("x-goog-channel-id");
    if (channelId) {
      try {
        const userId = await resolveUserIdByChannelId(channelId);
        if (userId) scheduleSyncForUser(userId);
      } catch {
        /* Supabase misconfigured */
      }
    }
  }

  return new NextResponse(null, { status: 200 });
}
