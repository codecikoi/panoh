import { describe, expect, it } from "vitest";
import { localToInstant, monthDateRange, nextDueDate, shiftMonthKey } from "./dates.js";

describe("dates", () => {
  it("shifts month keys", () => {
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
  });

  it("computes month ranges", () => {
    expect(monthDateRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-03-01" });
  });

  it("finds the next due date, clamping to month length", () => {
    expect(nextDueDate(15, "2026-10-13")).toBe("2026-10-15");
    expect(nextDueDate(15, "2026-10-15")).toBe("2026-10-15");
    expect(nextDueDate(15, "2026-10-16")).toBe("2026-11-15");
    expect(nextDueDate(31, "2026-02-10")).toBe("2026-02-28");
    expect(nextDueDate(31, "2026-03-01")).toBe("2026-03-31");
  });

  it("converts local date-times to instants", () => {
    const d = localToInstant("2026-10-15T09:00", "Asia/Tashkent");
    expect(d?.toISOString()).toBe("2026-10-15T04:00:00.000Z");
    expect(localToInstant("nonsense", "UTC")).toBeNull();
  });
});
