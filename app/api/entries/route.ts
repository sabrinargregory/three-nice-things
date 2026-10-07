import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { entry } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/session";
import { today } from "@/lib/date";
import { createEntryBodySchema, entryDateQuerySchema } from "@/lib/schemas";

/**
 * List the current user's entries for a date (defaults to today)
 * @tags entries
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dateParam = request.nextUrl.searchParams.get("date") ?? today();
  const parsed = entryDateQuerySchema.safeParse(dateParam);
  if (!parsed.success) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(entry)
    .where(and(eq(entry.userId, user.id), eq(entry.entryDate, parsed.data)))
    .orderBy(asc(entry.createdAt));

  return NextResponse.json({
    date: parsed.data,
    entries: rows.map(toEntryDto),
    complete: rows.length >= 3,
  });
}

/**
 * Log a nice thing for today
 * @tags entries
 * @body createEntryBodySchema required
 * @response 201:entrySchema:Created entry
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json: unknown = await request.json().catch(() => null);
  const body = createEntryBodySchema.safeParse(json);
  if (!body.success) {
    return NextResponse.json({ error: "content is required (1-500 chars)" }, { status: 400 });
  }

  const [row] = await db
    .insert(entry)
    .values({ userId: user.id, entryDate: today(), content: body.data.content })
    .returning();

  return NextResponse.json(toEntryDto(row), { status: 201 });
}

function toEntryDto(row: typeof entry.$inferSelect) {
  return {
    id: row.id,
    content: row.content,
    entryDate: row.entryDate,
    createdAt: row.createdAt.toISOString(),
  };
}
