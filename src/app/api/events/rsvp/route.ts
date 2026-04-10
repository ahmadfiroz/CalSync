import { NextRequest, NextResponse } from "next/server";
import { isStoreConnected } from "@/lib/store";
import { readStoreForUser } from "@/lib/store-db";
import { getClientForAccount } from "@/lib/accounts";
import { requireUserId } from "@/lib/api-session";

export const runtime = "nodejs";

const VALID_RESPONSES = new Set(["accepted", "declined", "tentative"]);

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
  const { calendarId, eventId, accountId, response } = b;

  if (typeof calendarId !== "string" || !calendarId) {
    return NextResponse.json({ error: "calendarId_required" }, { status: 400 });
  }
  if (typeof eventId !== "string" || !eventId) {
    return NextResponse.json({ error: "eventId_required" }, { status: 400 });
  }
  if (typeof accountId !== "string" || !accountId) {
    return NextResponse.json({ error: "accountId_required" }, { status: 400 });
  }
  if (typeof response !== "string" || !VALID_RESPONSES.has(response)) {
    return NextResponse.json({ error: "invalid_response" }, { status: 400 });
  }

  const cal = getClientForAccount(s.accounts, accountId);
  if (!cal) {
    return NextResponse.json({ error: "no_client" }, { status: 500 });
  }

  try {
    // Fetch the event to get the full attendees list
    const ev = await cal.events.get({ calendarId, eventId });
    const attendees = ev.data.attendees ?? [];
    const selfIdx = attendees.findIndex((a) => a.self === true);

    if (selfIdx === -1) {
      return NextResponse.json({ error: "not_an_attendee" }, { status: 400 });
    }

    const updated = [...attendees];
    updated[selfIdx] = { ...updated[selfIdx], responseStatus: response };

    await cal.events.patch({
      calendarId,
      eventId,
      sendUpdates: "all",
      requestBody: { attendees: updated },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "google_api_error", message: msg }, { status: 502 });
  }
}
