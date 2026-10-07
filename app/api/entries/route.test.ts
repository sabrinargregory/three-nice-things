import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { entry } from "@/lib/db/schema";
import { today } from "@/lib/date";
import { resetDb, seedEntry, seedUser } from "@/tests/helpers/db";
import { getSessionUser } from "@/lib/session";
import { GET, POST } from "./route";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));

const getSessionUserMock = vi.mocked(getSessionUser);

function GETRequest(date?: string) {
  const url = new URL("http://localhost:3000/api/entries");
  if (date) url.searchParams.set("date", date);
  return new NextRequest(url);
}

function POSTRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

describe("GET /api/entries", () => {
  it("returns 401 without a session", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const res = await GET(GETRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns today's entries with completion flag by default", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    const e1 = await seedEntry(u.id, today(), "first", new Date(1000));
    const e2 = await seedEntry(u.id, today(), "second", new Date(2000));

    const res = await GET(GETRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      date: today(),
      complete: false,
      entries: [
        { id: e1.id, content: "first", entryDate: today(), createdAt: new Date(1000).toISOString() },
        { id: e2.id, content: "second", entryDate: today(), createdAt: new Date(2000).toISOString() },
      ],
    });
  });

  it("marks a day complete at three entries", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    for (let i = 0; i < 3; i++) await seedEntry(u.id, today(), `thing ${i}`, new Date((i + 1) * 1000));

    const res = await GET(GETRequest());
    const body = await res.json();
    expect(body.complete).toBe(true);
    expect(body.entries).toHaveLength(3);
  });

  it("honors an explicit date query param", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    await seedEntry(u.id, "2026-01-15", "old one", new Date(1000));

    const res = await GET(GETRequest("2026-01-15"));
    const body = await res.json();
    expect(body.date).toBe("2026-01-15");
    expect(body.entries).toHaveLength(1);
    expect(body.complete).toBe(false);
  });

  it("rejects a malformed date param with 400", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    const res = await GET(GETRequest("01/15/2026"));
    expect(res.status).toBe(400);
  });

  it("never returns another user's entries", async () => {
    const u = await seedUser();
    const stranger = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    await seedEntry(stranger.id, today(), "not yours", new Date(1000));

    const res = await GET(GETRequest());
    const body = await res.json();
    expect(body.entries).toEqual([]);
  });
});

describe("POST /api/entries", () => {
  it("returns 401 without a session", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const res = await POST(POSTRequest({ content: "hi" }));
    expect(res.status).toBe(401);
  });

  it("creates an entry for today and returns the DTO", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);

    const res = await POST(POSTRequest({ content: "  watered the plants  " }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.content).toBe("watered the plants");
    expect(body.entryDate).toBe(today());

    const rows = await db.select().from(entry).where(eq(entry.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("watered the plants");
  });

  it("rejects an empty body with 400", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    const res = await POST(POSTRequest({}));
    expect(res.status).toBe(400);
  });

  it("rejects blank content with 400", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    const res = await POST(POSTRequest({ content: "   " }));
    expect(res.status).toBe(400);
  });

  it("rejects content over 500 chars with 400", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    const res = await POST(POSTRequest({ content: "x".repeat(501) }));
    expect(res.status).toBe(400);
  });

  it("rejects non-JSON bodies with 400", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    const req = new NextRequest("http://localhost:3000/api/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
