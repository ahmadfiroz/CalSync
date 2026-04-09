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
  const rules = s.mirrorRules ?? [];
  const hasRules = rules.some((r) => r.sourceCals.length > 0);
  if (!hasRules) {
    return NextResponse.json(
      {
        error: "no_rules",
        message: "Add at least one mirror rule before syncing.",
      },
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
