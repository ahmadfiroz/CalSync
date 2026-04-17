import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  isStoreConnected,
  type MirrorRule,
  type CalendarWatchChannel,
} from "@/lib/store";
import { readStoreForUser, writeStoreForUser } from "@/lib/store-db";
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
  return NextResponse.json({
    mirrorRules: s.mirrorRules ?? [],
    defaultCalendarId: s.defaultCalendarId ?? null,
  });
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

  const raw = (body as { mirrorRules?: unknown }).mirrorRules;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "mirrorRules_required" }, { status: 400 });
  }

  const accountIds = new Set(s.accounts.map((a) => a.id));
  const rules: MirrorRule[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return NextResponse.json({ error: "invalid_rule" }, { status: 400 });
    }
    const r = item as Record<string, unknown>;
    if (
      typeof r.sourceAccountId !== "string" ||
      typeof r.destAccountId !== "string" ||
      typeof r.destCalId !== "string" ||
      !Array.isArray(r.sourceCals) ||
      !(r.sourceCals as unknown[]).every((c) => typeof c === "string")
    ) {
      return NextResponse.json({ error: "invalid_rule" }, { status: 400 });
    }
    if ((r.sourceCals as string[]).length === 0) {
      return NextResponse.json(
        { error: "sourceCals_empty", message: "Each rule must have at least one source calendar." },
        { status: 400 }
      );
    }
    if (r.sourceAccountId === r.destAccountId) {
      return NextResponse.json(
        { error: "same_account", message: "Source and destination must be different accounts." },
        { status: 400 }
      );
    }
    if (!accountIds.has(r.sourceAccountId)) {
      return NextResponse.json(
        { error: "unknown_account", accountId: r.sourceAccountId },
        { status: 400 }
      );
    }
    if (!accountIds.has(r.destAccountId)) {
      return NextResponse.json(
        { error: "unknown_account", accountId: r.destAccountId },
        { status: 400 }
      );
    }
    rules.push({
      id: typeof r.id === "string" ? r.id : randomUUID(),
      sourceAccountId: r.sourceAccountId,
      sourceCals: r.sourceCals as string[],
      destAccountId: r.destAccountId,
      destCalId: r.destCalId,
    });
  }

  await stopAllWatchChannels(s.accounts, s.calendarWatchChannels);

  let calendarWatchChannels: CalendarWatchChannel[] | undefined;
  if (calendarPushAvailable() && rules.length > 0) {
    const allSourceCals = Array.from(
      new Set(rules.flatMap((r) => r.sourceCals))
    );
    if (allSourceCals.length > 0) {
      const registered = await registerWatchesForCalendars(
        s.accounts,
        allSourceCals
      );
      calendarWatchChannels = registered.length ? registered : undefined;
    }
  }

  await writeStoreForUser(userId, { ...s, mirrorRules: rules, calendarWatchChannels, defaultCalendarId: s.defaultCalendarId });

  void performFullSyncCoalescedForUser(userId);

  return NextResponse.json({
    ok: true,
    mirrorRules: rules,
    calendarPush: Boolean(calendarWatchChannels?.length),
  });
}

/** PATCH /api/config — update lightweight preferences without triggering a full sync. */
export async function PATCH(req: NextRequest) {
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
  const b = body as Record<string, unknown>;
  if ("defaultCalendarId" in b) {
    const val = b.defaultCalendarId;
    const defaultCalendarId = typeof val === "string" && val ? val : undefined;
    await writeStoreForUser(userId, { ...s, defaultCalendarId });
    return NextResponse.json({ ok: true, defaultCalendarId: defaultCalendarId ?? null });
  }
  return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
}
