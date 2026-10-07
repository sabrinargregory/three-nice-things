import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { entry } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/session";
import { today } from "@/lib/date";
import { entryIdPathSchema } from "@/lib/schemas";

/**
 * Delete one of today's entries
 * @tags entries
 * @path entryIdPathSchema
 * @response 204
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = entryIdPathSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // Only allow deleting today's entries; history is immutable.
  const deleted = await db
    .delete(entry)
    .where(
      and(
        eq(entry.id, parsed.data.id),
        eq(entry.userId, user.id),
        eq(entry.entryDate, today()),
      ),
    )
    .returning({ id: entry.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
