"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  deleteEntriesIdMutation,
  getEntriesOptions,
  getEntriesQueryKey,
  getMeOptions,
  getMeQueryKey,
  postEntriesMutation,
} from "@/api-client/@tanstack/react-query.gen";
import type { EntrySchema } from "@/api-client/types.gen";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { X } from "lucide-react";
import Link from "next/link";

export function TodayView() {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");

  const me = useQuery(getMeOptions());
  const entries = useQuery(getEntriesOptions());

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getEntriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getMeQueryKey() });
  };

  const add = useMutation({
    ...postEntriesMutation(),
    onSuccess: () => {
      setContent("");
      invalidate();
    },
    onError: () => toast.error("Couldn't save that. Try again."),
  });

  const remove = useMutation({
    ...deleteEntriesIdMutation(),
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't delete that entry."),
  });

  const date = entries.data?.date ?? me.data?.today.date ?? "";
  const list = entries.data?.entries ?? [];
  const count = list.length;
  const complete = count >= 3;
  const dateLabel = formatDate(date);

  return (
    <div className="w-full max-w-xl space-y-4 pt-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Today&apos;s nice things</CardTitle>
              <CardDescription>{dateLabel}</CardDescription>
            </div>
            <Badge variant={complete ? "default" : "secondary"}>{count} / 3</Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {entries.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <>
              {list.map((entry) => (
                <EntryRow key={entry.id} entry={entry} onDelete={() => remove.mutate({ path: { id: entry.id } })} />
              ))}
              {complete ? (
                <p className="rounded-md bg-primary/5 px-3 py-2 text-sm text-primary">
                  All three logged. Go be nice to yourself for the rest of the day.
                </p>
              ) : (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!content.trim() || add.isPending) return;
                    add.mutate({ body: { content: content.trim() } });
                  }}
                >
                  <Input
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={
                      count === 0
                        ? "Something nice you did for yourself today..."
                        : `Nice thing #${count + 1}...`
                    }
                    maxLength={500}
                  />
                  <Button type="submit" disabled={!content.trim() || add.isPending}>
                    {add.isPending ? "Logging..." : "Log it"}
                  </Button>
                </form>
              )}
            </>
          )}
        </CardContent>

        <CardFooter className="text-xs text-muted-foreground">
          {complete
            ? "The bot will leave you alone today."
            : `Log ${3 - count} more by 7:00 PM or the accountability bot will hear about it.`}
        </CardFooter>
      </Card>

      <div className="text-center text-sm text-muted-foreground">
        Out of ideas?{" "}
        <Link href="/history" className="underline underline-offset-4 hover:text-foreground">
          Browse your history
        </Link>
      </div>
    </div>
  );
}

function EntryRow({ entry, onDelete }: { entry: EntrySchema; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <Separator orientation="vertical" className="h-8 w-1 rounded-full bg-primary/60" />
      <p className="flex-1 text-sm">{entry.content}</p>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
        aria-label="Delete entry"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}