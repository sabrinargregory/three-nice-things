import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedEntry, seedUser } from "@/tests/helpers/db";
import { getSessionUser } from "@/lib/session";
import { today } from "@/lib/date";
import { GET } from "./route";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));

const getSessionUserMock = vi.mocked(getSessionUser);

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

describe("GET /api/me", () => {
  it("returns 401 without a session", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the profile plus today's progress", async () => {
    const u = await seedUser({ name: "Sabrina", email: "s@example.com", image: "https://img/x.png" });
    getSessionUserMock.mockResolvedValue(u);
    await seedEntry(u.id, today(), "one", new Date(1000));
    await seedEntry(u.id, today(), "two", new Date(2000));

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: u.id,
      name: "Sabrina",
      email: "s@example.com",
      image: "https://img/x.png",
      today: { date: today(), count: 2, complete: false },
    });
  });

  it("normalizes a missing image to null and flags completion at 3", async () => {
    const u = await seedUser({ image: null });
    getSessionUserMock.mockResolvedValue(u);
    for (let i = 0; i < 3; i++) await seedEntry(u.id, today(), `t${i}`, new Date((i + 1) * 1000));

    const body = await (await GET()).json();
    expect(body.image).toBeNull();
    expect(body.today).toEqual({ date: today(), count: 3, complete: true });
  });

  it("does not count other users' entries", async () => {
    const u = await seedUser();
    const stranger = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    await seedEntry(stranger.id, today(), "theirs", new Date(1000));

    const body = await (await GET()).json();
    expect(body.today.count).toBe(0);
  });
});
