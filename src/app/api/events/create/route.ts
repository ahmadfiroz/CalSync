import { NextRequest, NextResponse } from "next/server";
import { isStoreConnected } from "@/lib/store";
import { readStoreForUser } from "@/lib/store-db";
import { getClientForAccount } from "@/lib/accounts";
import { requireUserId } from "@/lib/api-session";

export const runtime = "nodejs";

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

  const b = body as Record<string, unknown>;
  const { calendarId, accountId, title, start, end, allDay, description, location } = b;

  if (typeof calendarId !== "string" || !calendarId) {
    return NextResponse.json({ error: "calendarId_required" }, { status: 400 });
  }
  if (typeof accountId !== "string" || !accountId) {
    return NextResponse.json({ error: "accountId_required" }, { status: 400 });
  }
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title_required" }, { status: 400 });
  }
  if (typeof start !== "string" || !start) {
    return NextResponse.json({ error: "start_required" }, { status: 400 });
  }
  if (!allDay && (typeof end !== "string" || !end)) {
    return NextResponse.json({ error: "end_required" }, { status: 400 });
  }

  const account = s.accounts.find((a) => a.id === accountId);
  if (!account) {
    return NextResponse.json({ error: "unknown_account" }, { status: 400 });
  }

  const cal = getClientForAccount(s.accounts, accountId);
  if (!cal) {
    return NextResponse.json({ error: "no_client" }, { status: 500 });
  }

  try {
    const event = await cal.events.insert({
      calendarId,
      requestBody: {
        summary: title.trim(),
        description: typeof description === "string" ? description : undefined,
        location: typeof location === "string" ? location : undefined,
        start: allDay
          ? { date: start }
          : { dateTime: start, timeZone: "UTC" },
        end: allDay
          ? { date: typeof end === "string" && end ? end : start }
          : { dateTime: end as string, timeZone: "UTC" },
      },
    });

    return NextResponse.json({ ok: true, eventId: event.data.id, htmlLink: event.data.htmlLink });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "google_api_error", message: msg }, { status: 502 });
  }
}
