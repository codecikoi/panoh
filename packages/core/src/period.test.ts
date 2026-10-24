import { describe, expect, it } from "vitest";
import { formatPeriod, makePeriod, monthPeriod, parsePeriod, periodDays, periodFromKey, periodKey, presetPeriods, previousPeriod, weekPeriod } from "./period.js";

describe("periods", () => {
  const today = "2026-10-24"; // Saturday

  it("builds weeks, months and the period before", () => {
    expect(weekPeriod(today)).toEqual({ from: "2026-10-19", to: "2026-10-25", kind: "week" });
    expect(monthPeriod("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28", kind: "month" });
    expect(previousPeriod(monthPeriod("2026-03"))).toEqual(monthPeriod("2026-02"));
    expect(previousPeriod(weekPeriod(today))).toEqual({ from: "2026-10-12", to: "2026-10-18", kind: "week" });
    expect(previousPeriod({ from: "2026-10-01", to: "2026-10-15", kind: "range" })).toEqual({ from: "2026-09-16", to: "2026-09-30", kind: "range" });
    expect(periodDays(monthPeriod("2026-10"))).toBe(31);
    const p = presetPeriods(today);
    expect([p.thisWeek.from, p.lastWeek.from, p.thisMonth.from, p.lastMonth.from]).toEqual(["2026-10-19", "2026-10-12", "2026-10-01", "2026-09-01"]);
  });

  it("parses /report arguments", () => {
    expect(parsePeriod("week", today)).toEqual(weekPeriod(today));
    expect(parsePeriod("Прошлая неделя", today)?.from).toBe("2026-10-12");
    expect(parsePeriod("o‘tgan oy", today)).toEqual(monthPeriod("2026-09"));
    expect(parsePeriod("2026-09", today)).toEqual(monthPeriod("2026-09"));
    expect(parsePeriod("01.10–15.10", today)).toEqual({ from: "2026-10-01", to: "2026-10-15", kind: "range" });
    expect(parsePeriod("1.10.2026 - 31.10.2026", today)).toEqual(monthPeriod("2026-10"));
    expect(parsePeriod("2026-10-19..2026-10-25", today)).toEqual(weekPeriod(today));
    expect(parsePeriod("20.12-05.01", "2027-01-10")).toEqual({ from: "2026-12-20", to: "2027-01-05", kind: "range" });
    for (const bad of ["", "завтра", "15.10-01.10.2026", "32.10-01.11", "01.01.2020-01.01.2026"]) expect(parsePeriod(bad, today)).toBeNull();
  });

  it("round-trips callback keys and rejects garbage", () => {
    const p = { from: "2026-10-01", to: "2026-10-15", kind: "range" as const };
    expect(periodKey(p)).toBe("20261001-20261015");
    expect(periodFromKey(periodKey(p))).toEqual(p);
    expect(periodFromKey("20261031-20261001")).toBeNull();
    expect(periodFromKey("x")).toBeNull();
    expect(makePeriod("2026-10-01", "2026-10-31")?.kind).toBe("month");
  });

  it("formats periods for people", () => {
    // Intl puts thin spaces around the range dash.
    const plain = (p: Parameters<typeof formatPeriod>[0], l: string) => formatPeriod(p, l).replace(/[\u2009\u202f]/g, " ");
    expect(formatPeriod(monthPeriod("2026-10"), "ru")).toBe("Октябрь 2026");
    expect(plain(weekPeriod(today), "en")).toBe("Oct 19 – 25, 2026");
    expect(plain(weekPeriod(today), "ru")).toBe("19–25 окт. 2026 г.");
    expect(plain({ from: "2026-09-28", to: "2026-10-04", kind: "week" }, "en")).toBe("Sep 28 – Oct 4, 2026");
  });
});
