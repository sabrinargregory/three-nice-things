"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  getEntriesMonthOptions,
  getEntriesOptions,
  getMeOptions,
} from "@/api-client/@tanstack/react-query.gen";
import type { EntrySchema } from "@/api-client/types.gen";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export function HistoryCalendar() {
  const [selected, setSelected] = useState<Date | undefined>();

  const month = useQuery(getEntriesMonthOptions());
  const me = useQuery(getMeOptions());

  const days = month.data?.days ?? [];
  const completeDates = days.filter((d) => d.complete).map((d) => toLocalDate(d.date));
  const partialDates = days.filter((d) => d.count > 0 && !d.complete).map((d) => toLocalDate(d.date));

  const streak = computeStreak(days, me.data?.today.date);
  const total = days.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="w-full max-w-xl space-y-4 pt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">History</h2>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">Back to today</Link>
        </Button>
      </div>

      <div className="flex gap-2 text-sm text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">{streak}</span> day streak
        </span>
        <span aria-hidden>&middot;</span>
        <span>
          <span className="font-semibold text-foreground">{total}</span> nice things all-time
        </span>
      </div>

      <Card className="w-fit">
        <CardContent className="pt-6">
          {month.isLoading ? (
            <Skeleton className="h-64 w-64" />
          ) : (
            <Calendar
              mode="single"
              selected={selected}
              onSelect={(date) => setSelected(date ?? undefined)}
              modifiers={{
                complete: completeDates,
                partial: partialDates,
              }}
              modifiersClassNames={{
                complete: "after:absolute after:inset-x-3 after:bottom-0.5 after:h-1 after:rounded-full after:bg-primary",
                partial: "after:absolute after:inset-x-3 after:bottom-0.5 after:h-1 after:rounded-full after:bg-primary/30",
              }}
              className="[--cell-size:--spacing(8)]"
            />
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Click a day with a marker to see what you logged. Steal from your past self.
      </p>

      <DayDialog date={selected} onClose={() => setSelected(undefined)} />
    </div>
  );
}

function DayDialog({ date, onClose }: { date: Date | undefined; onClose: () => void }) {
  const open = !!date;
  const iso = date ? toIso(date) : "";

  const day = useQuery({
    ...getEntriesOptions({ query: { date: iso } }),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{date ? formatDate(date) : ""}</DialogTitle>
          <DialogDescription>
            {day.data && day.data.entries.length > 0
              ? `${day.data.entries.length} nice thing${day.data.entries.length === 1 ? "" : "s"} logged`
              : "Nothing logged this day"}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-3 overflow-y-auto pr-2">
          {day.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            (day.data?.entries ?? []).map((entry: EntrySchema) => (
              <div key={entry.id} className="flex items-center gap-3">
                <Separator orientation="vertical" className="h-8 w-1 rounded-full bg-primary/60" />
                <p className="flex-1 text-sm">{entry.content}</p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function toLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function computeStreak(days: { date: string; complete: boolean }[], todayStr?: string): number {
  if (days.length === 0) return 0;
  const completeByDate = new Set(days.filter((d) => d.complete).map((d) => d.date));
  let cursor = todayStr ?? toIso(new Date());
  let streak = 0;
  // Today not being logged yet shouldn't break an existing streak.
  if (!completeByDate.has(cursor)) {
    const d = new Date(cursor + "T00:00:00");
    d.setDate(d.getDate() - 1);
    cursor = toIso(d);
  }
  while (completeByDate.has(cursor)) {
    streak++;
    const d = new Date(cursor + "T00:00:00");
    d.setDate(d.getDate() - 1);
    cursor = toIso(d);
  }
  return streak;
}