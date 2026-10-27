import { notFound, redirect } from "next/navigation";
import { logoutAction } from "@/auth/actions";
import { getAuthConfig } from "@/auth/config";
import { requireState } from "@/auth/dal";
import { getDb } from "@/auth/db";
import { hasLiveToken } from "@/auth/email-tokens";
import { AuthCard } from "@/components/auth/AuthCard";
import { ResendButton } from "@/components/auth/ResendButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirm your email · Software Factory Board" };

export default async function VerifyPendingPage({ searchParams }: { searchParams: Promise<{ failed?: string }> }) {
  if (!getAuthConfig().emailVerification) notFound();
  const session = await requireState("/account/verify");
  if (!session.needsEmailVerification) redirect("/"); // already confirmed: on to wherever they were going
  const failed = (await searchParams).failed === "1";
  // Users who registered before verification was switched on were never sent a link: say so instead of claiming we did.
  const waiting = hasLiveToken(getDb(), session.userId, "verify");

  return (
    <AuthCard title="Confirm your email address">
      {failed ? (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          Your account was created, but we could not send the email to <strong>{session.email}</strong> just now. Try the button below in a little while.
        </p>
      ) : waiting ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          We sent a link to <strong>{session.email}</strong>. Open it to continue (log in first if you are asked to). It works once and expires after 24 hours.
          If nothing arrives within a few minutes, check your spam folder, or ask for a new link. A new link replaces the old one.
        </p>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Before you continue, confirm that <strong>{session.email}</strong> is yours. We have not emailed you a link yet: press the button below and we will send one.
        </p>
      )}
      <ResendButton />
      <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
        Wrong address, or no mail ever arrives? Ask an administrator to confirm it for you.
      </p>
      <form action={logoutAction} className="mt-6">
        <button type="submit" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Log out
        </button>
      </form>
    </AuthCard>
  );
}
