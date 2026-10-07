import { auth } from "@/lib/auth";
import { headers } from "next/headers";

/** Returns the sessioned user or null. Safe to call from route handlers / server components. */
export async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}
