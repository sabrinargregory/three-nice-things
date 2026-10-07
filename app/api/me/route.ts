import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { entry } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/session";
import { today } from "@/lib/date";

/**
 * Current user profile plus today's progress
 * @tags me
 * @response 200:meSchema
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const date = today();
  const rows = await db
    .select({ id: entry.id })
    .from(entry)
    .where(and(eq(entry.userId, user.id), eq(entry.entryDate, date)));

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    today: { date, count: rows.length, complete: rows.length >= 3 },
  });
}
