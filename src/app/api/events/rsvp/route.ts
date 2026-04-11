import { NextRequest, NextResponse } from "next/server";
import { isStoreConnected } from "@/lib/store";
import { readStoreForUser } from "@/lib/store-db";
import { getClientForAccount } from "@/lib/accounts";
import { requireUserId } from "@/lib/api-session";
import type { calendar_v3 } from "@googleapis/calendar";

export const runtime = "nodejs";

const VALID_RESPONSES = new Set(["accepted", "declined", "tentative"]);

/** Fetch the event, find self attendee, return updated attendees array. */
async function buildUpdatedAttendees(
  cal: calendar_v3.Calendar,
  calendarId: string,
  eventId: string,
  responseStatus: string
): Promise<calendar_v3.Schema$EventAttendee[] | null> {
  const ev = await cal.events.get({ calendarId, eventId });
  const attendees = ev.data.attendees ?? [];
  const selfIdx = attendees.findIndex((a) => a.self === true);
  if (selfIdx === -1) return null;
  const updated = [...attendees];
  updated[selfIdx] = { ...updated[selfIdx], responseStatus };
  return updated;
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

  const b = body as Record<string, unknown>;
  const { calendarId, eventId, accountId, response, scope, recurringEventId, eventStartTime } = b;

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
    if (scope === "all") {
      // Patch the master recurring event — applies to all instances
      const masterId =
        typeof recurringEventId === "string" && recurringEventId
          ? recurringEventId
          : eventId;
      const updated = await buildUpdatedAttendees(cal, calendarId, masterId, response);
      if (!updated) return NextResponse.json({ error: "not_an_attendee" }, { status: 400 });
      await cal.events.patch({
        calendarId,
        eventId: masterId,
        sendUpdates: "all",
        requestBody: { attendees: updated },
      });
      return NextResponse.json({ ok: true });
    }

    if (scope === "following") {
      // List all instances from this event's start time and patch each one
      const masterId =
        typeof recurringEventId === "string" && recurringEventId
          ? recurringEventId
          : eventId;
      const timeMin =
        typeof eventStartTime === "string" && eventStartTime
          ? eventStartTime
          : new Date().toISOString();

      // Get attendees template from the current instance
      const templateAttendees = await buildUpdatedAttendees(cal, calendarId, eventId, response);
      if (!templateAttendees) return NextResponse.json({ error: "not_an_attendee" }, { status: 400 });

      // List instances from this point forward
      let pageToken: string | undefined;
      const instanceIds: string[] = [];
      do {
        const res = await cal.events.instances({
          calendarId,
          eventId: masterId,
          timeMin,
          maxResults: 500,
          pageToken,
        });
        for (const inst of res.data.items ?? []) {
          if (inst.id) instanceIds.push(inst.id);
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);

      // Patch each instance — fire in parallel, collect errors
      const results = await Promise.allSettled(
        instanceIds.map((id) =>
          cal.events.patch({
            calendarId,
            eventId: id,
            sendUpdates: "all",
            requestBody: { attendees: templateAttendees },
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return NextResponse.json({ ok: true, patched: instanceIds.length, failed });
    }

    // scope === "this" (default): patch just this instance
    const updated = await buildUpdatedAttendees(cal, calendarId, eventId, response);
    if (!updated) return NextResponse.json({ error: "not_an_attendee" }, { status: 400 });
    await cal.events.patch({
      calendarId,
      eventId,
      sendUpdates: "all",
      requestBody: { attendees: updated },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("invalid_grant")) {
      return NextResponse.json({
        error: "invalid_grant",
        message: "Google session expired. Re-connect this account in Sync Setup.",
      }, { status: 401 });
    }
    return NextResponse.json({ error: "google_api_error", message: msg }, { status: 502 });
  }
}
