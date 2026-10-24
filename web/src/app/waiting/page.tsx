import { redirect } from "next/navigation";
import { logoutAction } from "@/auth/actions";
import { requireUser } from "@/auth/dal";
import { gateRedirect } from "@/auth/gating";
import { AuthCard } from "@/components/auth/AuthCard";

export const metadata = { title: "Waiting for approval · Software Factory Board" };

export default async function WaitingPage() {
  const session = await requireUser();
  // Only users whose first blocker is "no roles" belong here; anyone else goes where their state says.
  const gate = gateRedirect(session);
  if (gate !== "/waiting") redirect(gate ?? "/");

  return (
    <AuthCard title="Waiting for approval">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        You are logged in as <strong>{session.email}</strong>, but an administrator has not given this account a role yet.
        Ask them to approve it, then log in again or reload this page.
      </p>
      <form action={logoutAction} className="mt-6">
        <button type="submit" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Log out
        </button>
      </form>
    </AuthCard>
  );
}
