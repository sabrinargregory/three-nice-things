"use client";

import { useSession, signOut } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";

export function AppHeader() {
  const { data: session, isPending } = useSession();

  return (
    <header className="flex items-center justify-between px-6 py-4">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        3 Nice Things
      </Link>
      {isPending ? (
        <Skeleton className="h-9 w-32" />
      ) : session?.user ? (
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {session.user.name}
          </span>
          <Avatar className="size-9">
            {session.user.image && <AvatarImage src={session.user.image} />}
            <AvatarFallback>
              {session.user.name?.slice(0, 1).toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      ) : null}
    </header>
  );
}