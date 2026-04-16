import { NextResponse } from "next/server";
import { isStoreConnected } from "@/lib/store";
import { readStoreForUser } from "@/lib/store-db";
import { resolveClientForCalendar } from "@/lib/accounts";
import { requireUserId } from "@/lib/api-session";
import { getSelfResponseStatus } from "@/lib/sync";

export const runtime = "nodejs";

type AllowedResponseStatus = "accepted" | "declined" | "tentative";

function normalizeStatus(v: unknown): AllowedResponseStatus | null {
  if (v === "accepted" || v === "declined" || v === "tentative") {
    return v;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      calendarId?: unknown;
      eventId?: unknown;
      responseStatus?: unknown;
    };
    const calendarId =
      typeof body.calendarId === "string" ? body.calendarId.trim() : "";
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    const responseStatus = normalizeStatus(body.responseStatus);
    if (!calendarId || !eventId || !responseStatus) {
      return NextResponse.json(
        { error: "invalid_request", message: "calendarId, eventId, and responseStatus are required." },
        { status: 400 }
      );
    }

    const store = await readStoreForUser(userId);
    if (!isStoreConnected(store)) {
      return NextResponse.json({ error: "not_connected" }, { status: 401 });
    }

    const cal = await resolveClientForCalendar(store.accounts, calendarId);
    if (!cal) {
      return NextResponse.json(
        { error: "calendar_not_found", message: "Calendar is not accessible with linked accounts." },
        { status: 404 }
      );
    }

    const eventRes = await cal.events.get({
      calendarId,
      eventId,
      alwaysIncludeEmail: true,
      maxAttendees: 250,
    });
    const event = eventRes.data;
    if (!event.attendees?.length) {
      return NextResponse.json(
        {
          error: "rsvp_not_supported",
          message: "This event does not include attendee RSVP data.",
        },
        { status: 400 }
      );
    }

    const accountEmails = new Set(
      store.accounts
        .map((a) => a.email?.trim().toLowerCase())
        .filter((x): x is string => Boolean(x))
    );
    const attendeeIndex = event.attendees.findIndex(
      (a) =>
        a.self === true ||
        (a.email ? accountEmails.has(a.email.trim().toLowerCase()) : false)
    );
    if (attendeeIndex < 0) {
      return NextResponse.json(
        {
          error: "rsvp_not_supported",
          message: "Could not find your attendee entry for this event.",
        },
        { status: 400 }
      );
    }

    const attendees = event.attendees.map((a) => ({ ...a }));
    attendees[attendeeIndex] = {
      ...attendees[attendeeIndex],
      responseStatus,
    };

    const patched = await cal.events.patch({
      calendarId,
      eventId,
      sendUpdates: "none",
      requestBody: {
        attendees,
      },
    });

    return NextResponse.json({
      ok: true,
      calendarId,
      eventId,
      responseStatus: getSelfResponseStatus(patched.data),
      declinedBySelf: getSelfResponseStatus(patched.data) === "declined",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "google_api", message },
      { status: 502 }
    );
  }
}
