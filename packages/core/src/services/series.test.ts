import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { createTestDb, type DbHandle } from "../db/client.js";
import { getOrCreateHousehold } from "./households.js";
import { findSimilarReminders, createReminder, getReminder, markReminderSent, snoozeReminder, similarTitles } from "./reminders.js";
import { createSeries, ensureNextOccurrence, nextOccurrence, normalizeRule, rescheduleSeries, stopSeries, updateSeries } from "./series.js";
import { findLastRecord } from "./records.js";

const TZ = "Asia/Tashkent";
const local = (iso: string) => DateTime.fromISO(iso, { zone: TZ });

describe("repeat rules", () => {
  it("completes a rule from the first occurrence and folds a full week into daily", () => {
    const monday = local("2026-11-23T09:00");
    expect(normalizeRule("weekly", null, null, monday)).toEqual({ freq: "weekly", weekdays: [1], dayOfMonth: null });
    expect(normalizeRule("weekly", [3, 1, 3, 9], null, monday)).toEqual({ freq: "weekly", weekdays: [1, 3], dayOfMonth: null });
    expect(normalizeRule("weekly", [1, 2, 3, 4, 5, 6, 7], null, null)).toEqual({ freq: "daily", weekdays: null, dayOfMonth: null });
    expect(normalizeRule("monthly", null, null, local("2026-11-25T09:00"))).toEqual({ freq: "monthly", weekdays: null, dayOfMonth: 25 });
    expect(normalizeRule("weekly", null, null, null)).toBeNull();
    expect(normalizeRule("monthly", null, null, null)).toBeNull();
  });

  it("finds the next occurrence after a moment, in the household time zone", () => {
    const at = (iso: string) => local(iso).toJSDate();
    const nine = { hour: 21, minute: 0 };
    // Daily at 21:00, asked at 22:00: tomorrow.
    expect(nextOccurrence({ freq: "daily", weekdays: null, dayOfMonth: null }, nine, TZ, "2026-11-20", at("2026-11-20T22:00"))?.period).toBe("2026-11-21");
    // Weekly on Monday and Wednesday, from Thursday: next Monday.
    expect(nextOccurrence({ freq: "weekly", weekdays: [1, 3], dayOfMonth: null }, nine, TZ, "2026-11-19", at("2026-11-19T08:00"))?.period).toBe("2026-11-23");
    // The 31st in a 30-day month is its last day.
    const monthly = nextOccurrence({ freq: "monthly", weekdays: null, dayOfMonth: 31 }, { hour: 9, minute: 30 }, TZ, "2026-11-02", at("2026-11-02T08:00"))!;
    expect(monthly.period).toBe("2026-11-30");
    expect(DateTime.fromJSDate(monthly.dueAt).setZone(TZ).toFormat("HH:mm")).toBe("09:30");
  });

  it("tells a duplicate reminder from a different one", () => {
    expect(similarTitles("митап течстар", "завтра митап техстар")).toBe(true);
    expect(similarTitles("Митап течстар!", "митап течстар")).toBe(true);
    expect(similarTitles("митап течстар", "митап стартап роаст luma в 15:00")).toBe(false);
    expect(similarTitles("хакатон 25го в саех", "митап течстар")).toBe(false);
    expect(similarTitles("завтра митап течстар", "завтра хакатон")).toBe(false);
  });
});

describe("repeating reminders (pglite)", () => {
  let handle: DbHandle;
  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("keeps exactly one upcoming occurrence, makes the next once one is sent, and stops", async () => {
    const { household } = await getOrCreateHousehold(handle.db, { chatId: -2001, chatType: "supergroup" }, { locale: "ru", currency: "UZS", timezone: TZ });
    const now = local("2026-11-20T10:00").toJSDate();
    const series = await createSeries(handle.db, { householdId: household.id, title: "записать расходы", freq: "daily", hour: 21, minute: 0 });

    const first = (await ensureNextOccurrence(handle.db, series, household, now))!;
    expect(first.period).toBe("2026-11-20");
    expect(first.defaultTime).toBe(false);
    // Idempotent while the upcoming one waits.
    expect((await ensureNextOccurrence(handle.db, series, household, now))!.id).toBe(first.id);

    // Sent and not marked: it stays open ("копятся"), and tomorrow's is scheduled.
    await markReminderSent(handle.db, first.id, 777);
    const evening = local("2026-11-20T21:00:30").toJSDate();
    const second = (await ensureNextOccurrence(handle.db, series, household, evening))!;
    expect(second.period).toBe("2026-11-21");
    expect((await getReminder(handle.db, first.id))?.status).toBe("sent");

    // Snoozing the sent one does not take the place of tomorrow's.
    await snoozeReminder(handle.db, first.id, local("2026-11-20T22:00").toJSDate());
    expect((await ensureNextOccurrence(handle.db, series, household, evening))!.id).toBe(second.id);

    // A new time moves the waiting occurrence; the snoozed one is left alone.
    const moved = (await updateSeries(handle.db, series.id, { hour: 20, minute: 15 }))!;
    const rescheduled = (await rescheduleSeries(handle.db, moved, household, evening))!;
    expect(rescheduled.period).toBe("2026-11-21");
    expect(DateTime.fromJSDate(rescheduled.dueAt).setZone(TZ).toFormat("HH:mm")).toBe("20:15");
    expect(await getReminder(handle.db, second.id)).toBeUndefined();
    expect((await getReminder(handle.db, first.id))?.status).toBe("scheduled");

    await stopSeries(handle.db, series.id);
    expect((await getReminder(handle.db, rescheduled.id))?.status).toBe("cancelled");
    expect(await ensureNextOccurrence(handle.db, { ...moved, active: false }, household, evening)).toBeUndefined();
  });

  it("uses the household default hour when the series has none, and is not taken for the family's last record", async () => {
    const { household } = await getOrCreateHousehold(handle.db, { chatId: -2002, chatType: "supergroup" }, { locale: "ru", currency: "UZS", timezone: TZ });
    const series = await createSeries(handle.db, { householdId: household.id, title: "вынести мусор", freq: "weekly", weekdays: [1], hour: null });
    const next = (await ensureNextOccurrence(handle.db, series, household, local("2026-11-20T10:00").toJSDate()))!;
    expect(next.period).toBe("2026-11-23");
    expect(next.defaultTime).toBe(true);
    expect(DateTime.fromJSDate(next.dueAt).setZone(TZ).hour).toBe(household.reminderHour);
    // The scheduler's occurrence is not "the last record"; the series itself is.
    expect((await findLastRecord(handle.db, household.id))?.type).toBe("series");
  });

  it("finds a similar one-off reminder on the same day only", async () => {
    const { household } = await getOrCreateHousehold(handle.db, { chatId: -2003, chatType: "supergroup" }, { locale: "ru", currency: "UZS", timezone: TZ });
    const due = (iso: string) => local(iso).toJSDate();
    await createReminder(handle.db, { householdId: household.id, title: "митап течстар", dueAt: due("2026-11-23T09:00") });
    await createReminder(handle.db, { householdId: household.id, title: "хакатон 25го в саех", dueAt: due("2026-11-24T09:00") });
    const same = await findSimilarReminders(handle.db, household.id, TZ, "завтра митап техстар", due("2026-11-23T13:00"));
    expect(same.map((r) => r.title)).toEqual(["митап течстар"]);
    expect(await findSimilarReminders(handle.db, household.id, TZ, "митап течстар", due("2026-11-24T13:00"))).toEqual([]);
  });
});
