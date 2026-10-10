// ─── Business-day boundaries in America/Chicago ─────────────────────
// Timestamps are stored in UTC; "today" and "per day" for a Houston
// warehouse mean the Chicago calendar day. These helpers convert a Chicago
// calendar date to the UTC instants that bound it, daylight-saving included,
// so the dashboard's "removed today", the one-alert-per-day rule and the
// date-range filters all agree with the clock on the floor.

export const BUSINESS_TZ = "America/Chicago";

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface WallParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function chicagoWallClock(at: Date): WallParts {
  const map: Record<string, number> = {};
  for (const p of wallClock.formatToParts(at)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  return { y: map.year, m: map.month, d: map.day, h: map.hour, mi: map.minute, s: map.second };
}

/** Minutes Chicago wall-clock is ahead of UTC at `at` (negative: -300 CDT, -360 CST). */
function offsetMinutesAt(at: Date): number {
  const w = chicagoWallClock(at);
  const asIfUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  return Math.round((asIfUtc - at.getTime()) / 60_000);
}

/** UTC instant of local midnight at the start of the Chicago calendar date y-m-d. */
export function chicagoMidnight(y: number, m: number, d: number): Date {
  // Midnight as if Chicago were UTC, then shift by the offset in force at
  // that moment. Around a DST switch the offset at the first guess can differ
  // from the one at the real midnight, so refine once.
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const guess = new Date(naive - offsetMinutesAt(new Date(naive)) * 60_000);
  return new Date(naive - offsetMinutesAt(guess) * 60_000);
}

function nextCalendarDay(y: number, m: number, d: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

function boundsOf(y: number, m: number, d: number): { start: Date; end: Date } {
  const start = chicagoMidnight(y, m, d);
  const next = chicagoMidnight(...nextCalendarDay(y, m, d));
  return { start, end: new Date(next.getTime() - 1) };
}

/** Start and end (inclusive, millisecond precision) of the Chicago calendar day containing `at`. */
export function chicagoDayBounds(at: Date = new Date()): { start: Date; end: Date } {
  const w = chicagoWallClock(at);
  return boundsOf(w.y, w.m, w.d);
}

/**
 * Parses a "YYYY-MM-DD" query value as a Chicago calendar date and returns
 * the UTC bounds of that day. Anything else (other formats, impossible dates,
 * non-strings) returns null so the caller can answer 400 instead of handing
 * Prisma an Invalid Date.
 */
export function parseChicagoDate(input: unknown): { start: Date; end: Date } | null {
  if (typeof input !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return boundsOf(y, mo, d);
}
