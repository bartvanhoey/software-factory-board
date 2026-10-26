import { logoutAction } from "@/auth/actions";
import { requirePendingMfa } from "@/auth/dal";
import { verifyMfaAction } from "@/auth/mfa-actions";
import { AuthCard } from "@/components/auth/AuthCard";
import { CodeForm } from "@/components/auth/CodeForm";

export const metadata = { title: "Second step · Software Factory Board" };

export default async function MfaLoginPage() {
  const session = await requirePendingMfa();
  return (
    <AuthCard title="Enter your code">
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Your password was accepted for <strong>{session.email}</strong>. Enter the 6-digit code from your authenticator app, or one of your recovery codes. You have five minutes.
      </p>
      <CodeForm action={verifyMfaAction} label="Code" submit="Continue" hint="For example 123456, or ABCD-EFGH-JKMN." />
      <form action={logoutAction} className="mt-6">
        <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          Cancel and log out
        </button>
      </form>
    </AuthCard>
  );
}
