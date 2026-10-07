const TIMEZONE = process.env.REMINDER_TZ || undefined;

/** Today's date as YYYY-MM-DD in the deployment timezone. */
export function today(): string {
  return toDateStr(new Date());
}

/** Date N days before today, as YYYY-MM-DD. */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateStr(d);
}

/** Inclusive list of the last n dates ending today, oldest first. */
export function lastNDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(daysAgo(i));
  return out;
}

function toDateStr(d: Date): string {
  // en-CA locale yields YYYY-MM-DD
  return d.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}
