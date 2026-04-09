import { NextRequest, NextResponse } from "next/server";
import {
  readStoreForUser,
  writeStoreForUser,
} from "@/lib/store-db";
import { isStoreConnected, type CalendarWatchChannel } from "@/lib/store";
import {
  calendarPushAvailable,
  registerWatchesForCalendars,
  stopAllWatchChannels,
} from "@/lib/calendar-watch";
import { SESSION_COOKIE } from "@/lib/session";
import { requireUserId } from "@/lib/api-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let accountId: string | undefined;
  try {
    const body = await req.json();
    if (
      body &&
      typeof body === "object" &&
      typeof (body as { accountId?: unknown }).accountId === "string"
    ) {
      accountId = (body as { accountId: string }).accountId;
    }
  } catch {
    /* no body */
  }

  const s = await readStoreForUser(userId);
  if (!isStoreConnected(s)) {
    return NextResponse.json({ ok: true });
  }

  const clearSession = (res: NextResponse) => {
    res.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return res;
  };

  if (!accountId) {
    await stopAllWatchChannels(s.accounts, s.calendarWatchChannels);
    await writeStoreForUser(userId, {
      version: 3,
      accounts: [],
      mirrorRules: [],
    });
    return clearSession(NextResponse.json({ ok: true }));
  }

  const nextAccounts = s.accounts.filter((a) => a.id !== accountId);
  if (nextAccounts.length === 0) {
    await stopAllWatchChannels(s.accounts, s.calendarWatchChannels);
    await writeStoreForUser(userId, {
      version: 3,
      accounts: [],
      mirrorRules: [],
    });
    return clearSession(NextResponse.json({ ok: true }));
  }

  await stopAllWatchChannels(s.accounts, s.calendarWatchChannels);

  // Remove any mirror rules that reference the removed account
  const remainingAccountIds = new Set(nextAccounts.map((a) => a.id));
  const mirrorRules = s.mirrorRules.filter(
    (r) =>
      remainingAccountIds.has(r.sourceAccountId) &&
      remainingAccountIds.has(r.destAccountId)
  );

  let calendarWatchChannels: CalendarWatchChannel[] | undefined;
  if (calendarPushAvailable() && mirrorRules.length > 0) {
    const allSourceCals = Array.from(
      new Set(mirrorRules.flatMap((r) => r.sourceCals))
    );
    if (allSourceCals.length > 0) {
      const registered = await registerWatchesForCalendars(
        nextAccounts,
        allSourceCals
      );
      calendarWatchChannels = registered.length ? registered : undefined;
    }
  }

  await writeStoreForUser(userId, {
    version: 3,
    accounts: nextAccounts,
    mirrorRules,
    calendarWatchChannels,
  });
  return NextResponse.json({ ok: true });
}
