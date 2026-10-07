import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { entry } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/session";

/**
 * All-time day-by-day completion counts (calendar view)
 * @tags entries
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({ entryDate: entry.entryDate })
    .from(entry)
    .where(eq(entry.userId, user.id));

  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.entryDate, (counts.get(row.entryDate) ?? 0) + 1);

  return NextResponse.json({
    days: [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count, complete: count >= 3 })),
  });
}