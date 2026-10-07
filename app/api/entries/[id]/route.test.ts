import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { entry } from "@/lib/db/schema";
import { daysAgo, today } from "@/lib/date";
import { resetDb, seedEntry, seedUser } from "@/tests/helpers/db";
import { getSessionUser } from "@/lib/session";
import { DELETE } from "./route";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));

const getSessionUserMock = vi.mocked(getSessionUser);

function DELETERequest(id: string) {
  return [
    new NextRequest(`http://localhost:3000/api/entries/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) },
  ] as const;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

describe("DELETE /api/entries/[id]", () => {
  it("returns 401 without a session", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const res = await DELETE(...DELETERequest("1"));
    expect(res.status).toBe(401);
  });

  it("deletes one of today's entries and returns 204", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    const e = await seedEntry(u.id, today(), "delete me", new Date(1000));

    const res = await DELETE(...DELETERequest(String(e.id)));
    expect(res.status).toBe(204);

    const rows = await db.select().from(entry).where(eq(entry.id, e.id));
    expect(rows).toHaveLength(0);
  });

  it("returns 404 for an unknown id", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    const res = await DELETE(...DELETERequest("999"));
    expect(res.status).toBe(404);
  });

  it("refuses to delete entries from previous days", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    const e = await seedEntry(u.id, daysAgo(1), "history", new Date(1000));

    const res = await DELETE(...DELETERequest(String(e.id)));
    expect(res.status).toBe(404);
    const rows = await db.select().from(entry).where(eq(entry.id, e.id));
    expect(rows).toHaveLength(1);
  });

  it("refuses to delete another user's entry", async () => {
    const u = await seedUser();
    const stranger = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    const e = await seedEntry(stranger.id, today(), "not yours", new Date(1000));

    const res = await DELETE(...DELETERequest(String(e.id)));
    expect(res.status).toBe(404);
    const rows = await db.select().from(entry).where(eq(entry.id, e.id));
    expect(rows).toHaveLength(1);
  });

  it("rejects a malformed id with 400", async () => {
    const u = await seedUser();
    getSessionUserMock.mockResolvedValue(u);
    const res = await DELETE(...DELETERequest("abc"));
    expect(res.status).toBe(400);
  });
});
