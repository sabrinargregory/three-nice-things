import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedEntry, seedUser } from "@/tests/helpers/db";
import { getSessionUser } from "@/lib/session";
import { GET } from "./route";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));

const getSessionUserMock = vi.mocked(getSessionUser);

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

describe("GET /api/entries/month", () => {
  it("returns 401 without a session", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("aggregates per-day counts, sorted by date, with completion flags", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    await seedEntry(u.id, "2026-10-01", "a", new Date(1000));
    await seedEntry(u.id, "2026-10-02", "b", new Date(2000));
    await seedEntry(u.id, "2026-10-02", "c", new Date(3000));
    await seedEntry(u.id, "2026-10-03", "d", new Date(4000));
    await seedEntry(u.id, "2026-10-03", "e", new Date(5000));
    await seedEntry(u.id, "2026-10-03", "f", new Date(6000));

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days).toEqual([
      { date: "2026-10-01", count: 1, complete: false },
      { date: "2026-10-02", count: 2, complete: false },
      { date: "2026-10-03", count: 3, complete: true },
    ]);
  });

  it("returns an empty list for a user with no entries", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    const res = await GET();
    expect(await res.json()).toEqual({ days: [] });
  });

  it("only counts the current user's entries", async () => {
    const u = await seedUser();
    const stranger = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    await seedEntry(stranger.id, "2026-10-01", "theirs", new Date(1000));

    const res = await GET();
    expect(await res.json()).toEqual({ days: [] });
  });
});
