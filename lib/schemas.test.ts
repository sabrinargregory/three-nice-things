import { describe, expect, it } from "vitest";
import {
  createEntryBodySchema,
  entryDateQuerySchema,
  entryIdPathSchema,
  entrySchema,
  meSchema,
} from "./schemas";

describe("createEntryBodySchema", () => {
  it("accepts a normal string", () => {
    const result = createEntryBodySchema.safeParse({ content: "Went for a walk" });
    expect(result.success).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    const result = createEntryBodySchema.safeParse({ content: "  cooked dinner  " });
    expect(result).toMatchObject({ success: true, data: { content: "cooked dinner" } });
  });

  it("rejects an empty string", () => {
    expect(createEntryBodySchema.safeParse({ content: "" }).success).toBe(false);
  });

  it("rejects whitespace-only content", () => {
    expect(createEntryBodySchema.safeParse({ content: "   " }).success).toBe(false);
  });

  it("rejects content over 500 chars", () => {
    expect(createEntryBodySchema.safeParse({ content: "x".repeat(501) }).success).toBe(false);
  });

  it("accepts exactly 500 chars", () => {
    expect(createEntryBodySchema.safeParse({ content: "x".repeat(500) }).success).toBe(true);
  });

  it("rejects non-string content", () => {
    expect(createEntryBodySchema.safeParse({ content: 42 }).success).toBe(false);
    expect(createEntryBodySchema.safeParse({}).success).toBe(false);
  });
});

describe("entryDateQuerySchema", () => {
  it("accepts a YYYY-MM-DD date", () => {
    expect(entryDateQuerySchema.safeParse("2026-10-06").success).toBe(true);
  });

  it("rejects other formats", () => {
    expect(entryDateQuerySchema.safeParse("10/06/2026").success).toBe(false);
    expect(entryDateQuerySchema.safeParse("2026-10-6").success).toBe(false);
    expect(entryDateQuerySchema.safeParse("not-a-date").success).toBe(false);
    expect(entryDateQuerySchema.safeParse("").success).toBe(false);
  });
});

describe("entryIdPathSchema", () => {
  it("coerces a numeric string to a positive int", () => {
    expect(entryIdPathSchema.safeParse({ id: "42" })).toMatchObject({ success: true, data: { id: 42 } });
  });

  it("rejects zero, negatives, and non-numbers", () => {
    expect(entryIdPathSchema.safeParse({ id: "0" }).success).toBe(false);
    expect(entryIdPathSchema.safeParse({ id: "-3" }).success).toBe(false);
    expect(entryIdPathSchema.safeParse({ id: "abc" }).success).toBe(false);
    expect(entryIdPathSchema.safeParse({ id: "1.5" }).success).toBe(false);
    expect(entryIdPathSchema.safeParse({}).success).toBe(false);
  });
});

describe("entrySchema", () => {
  it("validates the API DTO shape", () => {
    const dto = {
      id: 1,
      content: "Walked the dog",
      entryDate: "2026-10-06",
      createdAt: "2026-10-06T18:00:00.000Z",
    };
    expect(entrySchema.safeParse(dto).success).toBe(true);
  });

  it("rejects malformed dates and missing fields", () => {
    expect(
      entrySchema.safeParse({ id: 1, content: "x", entryDate: "2026-13-01", createdAt: "2026-10-06T18:00:00.000Z" })
        .success,
    ).toBe(false);
    expect(entrySchema.safeParse({ id: 1, content: "x", entryDate: "2026-10-06" }).success).toBe(false);
  });
});

describe("meSchema", () => {
  it("validates the /api/me response shape", () => {
    const me = {
      id: "user-1",
      name: "Sabrina",
      email: "s@example.com",
      image: null,
      today: { date: "2026-10-06", count: 2, complete: false },
    };
    expect(meSchema.safeParse(me).success).toBe(true);
  });

  it("rejects an incomplete today block", () => {
    expect(meSchema.safeParse({ id: "u", name: "n", email: "e", image: null, today: {} }).success).toBe(false);
  });
});
