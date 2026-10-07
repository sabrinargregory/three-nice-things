import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/date reads REMINDER_TZ once at module load, so each test re-imports it
// with a stubbed env and a frozen clock.
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.useRealTimers();
});

async function loadDateModule() {
  return import("./date");
}

describe("today()", () => {
  it("returns the clock date as YYYY-MM-DD in the configured timezone", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-06T23:30:00Z") });
    vi.stubEnv("REMINDER_TZ", "UTC");
    const { today } = await loadDateModule();
    expect(today()).toBe("2026-10-06");
  });

  it("rolls over to the next day in timezones ahead of the clock", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-06T12:00:00Z") });
    vi.stubEnv("REMINDER_TZ", "Pacific/Auckland"); // UTC+13 in October
    const { today } = await loadDateModule();
    expect(today()).toBe("2026-10-07");
  });

  it("stays on the previous day in timezones behind the clock", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-06T02:00:00Z") });
    vi.stubEnv("REMINDER_TZ", "America/Los_Angeles"); // UTC-7 in October
    const { today } = await loadDateModule();
    expect(today()).toBe("2026-10-05");
  });

  it("falls back to the server timezone when REMINDER_TZ is unset", async () => {
    vi.useFakeTimers({ now: new Date("2026-03-14T05:59:00Z") });
    vi.unstubAllEnvs(); // no REMINDER_TZ
    const { today } = await loadDateModule();
    // Format should still be a valid YYYY-MM-DD date regardless of server tz.
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number(today().slice(5, 7))).toBeGreaterThanOrEqual(1);
    expect(Number(today().slice(5, 7))).toBeLessThanOrEqual(12);
  });
});

describe("daysAgo()", () => {
  it("subtracts N days from the clock date", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-06T12:00:00Z") });
    vi.stubEnv("REMINDER_TZ", "UTC");
    const { daysAgo } = await loadDateModule();
    expect(daysAgo(0)).toBe("2026-10-06");
    expect(daysAgo(1)).toBe("2026-10-05");
    expect(daysAgo(6)).toBe("2026-09-30");
  });

  it("crosses month and year boundaries", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-01T00:30:00Z") });
    vi.stubEnv("REMINDER_TZ", "UTC");
    const { daysAgo } = await loadDateModule();
    expect(daysAgo(1)).toBe("2025-12-31");
    expect(daysAgo(2)).toBe("2025-12-30");
  });

  it("handles leap years", async () => {
    vi.useFakeTimers({ now: new Date("2028-03-01T12:00:00Z") });
    vi.stubEnv("REMINDER_TZ", "UTC");
    const { daysAgo } = await loadDateModule();
    expect(daysAgo(1)).toBe("2028-02-29");
  });
});

describe("lastNDays()", () => {
  it("returns the last n dates ending today, oldest first", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-06T12:00:00Z") });
    vi.stubEnv("REMINDER_TZ", "UTC");
    const { lastNDays } = await loadDateModule();
    expect(lastNDays(1)).toEqual(["2026-10-06"]);
    expect(lastNDays(3)).toEqual(["2026-10-04", "2026-10-05", "2026-10-06"]);
  });

  it("returns an empty list for n = 0", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-06T12:00:00Z") });
    vi.stubEnv("REMINDER_TZ", "UTC");
    const { lastNDays } = await loadDateModule();
    expect(lastNDays(0)).toEqual([]);
  });
});
