import { NextRequest, NextResponse } from "next/server";
import { isStoreConnected } from "@/lib/store";
import { readStoreForUser } from "@/lib/store-db";
import { getCalendarClient } from "@/lib/google";
import { listCalendarsMerged } from "@/lib/calendar-directory";
import { requireUserId } from "@/lib/api-session";

export const runtime = "nodejs";

export type { ListedCal } from "@/lib/calendar-directory";

export async function GET() {
  try {
    const userId = await requireUserId();
    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const s = await readStoreForUser(userId);
    const dir = await listCalendarsMerged(s);
    if (!dir) {
      return NextResponse.json({ error: "not_connected" }, { status: 401 });
    }
    return NextResponse.json({ calendars: dir.calendars, staleAccounts: dir.staleAccounts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "google_api", message: msg }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
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
  const accountId = String((body as { accountId?: unknown }).accountId ?? "").trim();
  const acc = s.accounts.find((a) => a.id === accountId);
  if (!acc) {
    return NextResponse.json({ error: "unknown_account" }, { status: 400 });
  }
  const cal = getCalendarClient(acc.refreshToken);
  const action = (body as { action?: unknown }).action;
  try {
    if (action === "create") {
      const summary = String((body as { summary?: unknown }).summary ?? "").trim();
      if (!summary) {
        return NextResponse.json({ error: "summary_required" }, { status: 400 });
      }
      const created = await cal.calendars.insert({
        requestBody: { summary },
      });
      const id = created.data.id;
      if (!id) {
        return NextResponse.json({ error: "create_failed" }, { status: 500 });
      }
      return NextResponse.json({
        ok: true,
        calendar: { id, summary: created.data.summary || summary },
      });
    }
    if (action === "add") {
      const calendarId = String((body as { calendarId?: unknown }).calendarId ?? "").trim();
      if (!calendarId) {
        return NextResponse.json({ error: "calendarId_required" }, { status: 400 });
      }
      const inserted = await cal.calendarList.insert({
        requestBody: { id: calendarId },
      });
      const id = inserted.data.id ?? calendarId;
      return NextResponse.json({
        ok: true,
        calendar: {
          id,
          summary: inserted.data.summary || id,
          primary: Boolean(inserted.data.primary),
        },
      });
    }
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "google_api", message: msg }, { status: 502 });
  }
}
