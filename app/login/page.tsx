import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { LoginForm } from "@/components/login-form";

export const instant = false;

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <LoginForm />
    </main>
  );
}