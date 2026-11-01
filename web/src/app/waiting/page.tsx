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
      <p className="text-sm text-muted">
        You are logged in as <strong>{session.email}</strong>, but an administrator has not given this account a role yet.
        Ask them to approve it, then reload this page.
      </p>
      <form action={logoutAction} className="mt-6">
        <button type="submit" className="btn">
          Log out
        </button>
      </form>
    </AuthCard>
  );
}
