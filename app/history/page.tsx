import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { AppHeader } from "@/components/app-header";
import { HistoryCalendar } from "@/components/history-calendar";

export const instant = false;

export default async function HistoryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <>
      <AppHeader />
      <main className="flex flex-1 justify-center px-4 pb-16">
        <HistoryCalendar />
      </main>
    </>
  );
}