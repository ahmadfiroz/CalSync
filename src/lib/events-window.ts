/** Dashboard “Time range” presets; bounds use the browser’s local timezone. */
export type EventsRangePreset = "7d" | "this-month" | "next-month";

/**
 * Longest span we allow for GET /api/events when using explicit timeMin/timeMax
 * (covers a full calendar month plus small clock skew).
 */
export const MAX_EVENTS_WINDOW_MS = 40 * 24 * 60 * 60 * 1000;

export function buildEventsTimeWindow(
  preset: EventsRangePreset,
  now = new Date()
): { timeMin: Date; timeMax: Date } {
  if (preset === "7d") {
    const timeMin = new Date(now);
    const timeMax = new Date(now);
    timeMax.setDate(timeMax.getDate() + 7);
    return { timeMin, timeMax };
  }
  if (preset === "this-month") {
    const timeMin = new Date(now);
    const timeMax = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );
    return { timeMin, timeMax };
  }
  const timeMin = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    1,
    0,
    0,
    0,
    0
  );
  const timeMax = new Date(
    now.getFullYear(),
    now.getMonth() + 2,
    0,
    23,
    59,
    59,
    999
  );
  return { timeMin, timeMax };
}
