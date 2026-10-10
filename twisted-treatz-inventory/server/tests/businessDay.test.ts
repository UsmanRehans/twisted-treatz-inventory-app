// ─── Chicago business-day boundaries ─────────────────────────────────
// The Houston warehouse's "today" is a Chicago calendar day. These tests pin
// the UTC instants that bound a day, including the two daylight-saving
// switches (a 23-hour day in March, a 25-hour day in November).

import { describe, it, expect } from "vitest";
import { chicagoDayBounds, chicagoMidnight, parseChicagoDate } from "../src/lib/businessDay.js";

const iso = (d: Date) => d.toISOString();

describe("chicagoMidnight", () => {
  it("is 05:00Z during daylight time and 06:00Z during standard time", () => {
    expect(iso(chicagoMidnight(2026, 7, 4))).toBe("2026-07-04T05:00:00.000Z");
    expect(iso(chicagoMidnight(2026, 1, 15))).toBe("2026-01-15T06:00:00.000Z");
  });

  it("handles the spring-forward day (2026-03-08) and the day after", () => {
    expect(iso(chicagoMidnight(2026, 3, 8))).toBe("2026-03-08T06:00:00.000Z");
    expect(iso(chicagoMidnight(2026, 3, 9))).toBe("2026-03-09T05:00:00.000Z");
  });

  it("handles the fall-back day (2026-11-01) and the day after", () => {
    expect(iso(chicagoMidnight(2026, 11, 1))).toBe("2026-11-01T05:00:00.000Z");
    expect(iso(chicagoMidnight(2026, 11, 2))).toBe("2026-11-02T06:00:00.000Z");
  });
});

describe("chicagoDayBounds", () => {
  it("bounds an ordinary afternoon", () => {
    const b = chicagoDayBounds(new Date("2026-10-09T20:30:00.000Z")); // 15:30 CDT
    expect(iso(b.start)).toBe("2026-10-09T05:00:00.000Z");
    expect(iso(b.end)).toBe("2026-10-10T04:59:59.999Z");
  });

  it("keeps a late evening on the same Chicago day even though UTC has rolled over", () => {
    const b = chicagoDayBounds(new Date("2026-10-10T03:00:00.000Z")); // 22:00 CDT on Oct 9
    expect(iso(b.start)).toBe("2026-10-09T05:00:00.000Z");
    expect(iso(b.end)).toBe("2026-10-10T04:59:59.999Z");
  });

  it("starts a new day at Chicago midnight", () => {
    const b = chicagoDayBounds(new Date("2026-10-10T05:00:00.000Z"));
    expect(iso(b.start)).toBe("2026-10-10T05:00:00.000Z");
  });

  it("gives a 23-hour day in March and a 25-hour day in November", () => {
    const spring = parseChicagoDate("2026-03-08")!;
    expect(spring.end.getTime() - spring.start.getTime() + 1).toBe(23 * 3_600_000);
    const fall = parseChicagoDate("2026-11-01")!;
    expect(fall.end.getTime() - fall.start.getTime() + 1).toBe(25 * 3_600_000);
  });
});

describe("parseChicagoDate", () => {
  it("parses YYYY-MM-DD as a Chicago calendar day", () => {
    const d = parseChicagoDate("2026-10-09")!;
    expect(iso(d.start)).toBe("2026-10-09T05:00:00.000Z");
    expect(iso(d.end)).toBe("2026-10-10T04:59:59.999Z");
  });

  it.each([
    ["garbage", "garbage"],
    ["impossible date", "2026-02-30"],
    ["unpadded", "2026-6-1"],
    ["datetime", "2026-10-09T10:00:00Z"],
    ["number", 42],
    ["undefined", undefined],
    ["empty", ""],
  ])("returns null for %s", (_label, value) => {
    expect(parseChicagoDate(value)).toBeNull();
  });
});
