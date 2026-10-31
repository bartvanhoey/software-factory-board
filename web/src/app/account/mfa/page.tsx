import Link from "next/link";
import { requireState } from "@/auth/dal";
import { getDb } from "@/auth/db";
import { recoveryCodesLeft } from "@/auth/mfa";
import { disableOwnMfaAction, regenerateRecoveryCodesAction, startReenrolmentAction } from "@/auth/mfa-actions";
import { AuthCard } from "@/components/auth/AuthCard";
import { CodeForm } from "@/components/auth/CodeForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "MFA · Software Factory Board" };

export default async function MfaPage() {
  const session = await requireState("/account/mfa");
  const left = session.mfaEnabled ? recoveryCodesLeft(getDb(), session.userId) : 0;
  const isAdmin = session.roles.includes("admin");

  return (
    <AuthCard title="Multi-factor authentication">
      {!session.mfaEnabled ? (
        <>
          <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
            MFA is <strong>off</strong>. With it on, you also enter a code from an authenticator app each time you log in.
          </p>
          <Link href="/account/mfa/setup" className="inline-block rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
            Turn on MFA
          </Link>
        </>
      ) : (
        <div className="space-y-8">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            MFA is <strong>on</strong>{session.mfaRequired ? " and required for your account" : ""}.{" "}
            {isAdmin
              ? session.mfaRequired
                ? "To turn it off, stop requiring it on the Users screen first."
                : "You can turn it off below."
              : `Only an administrator can turn it off${session.mfaRequired ? ", and not while it is required" : ""}.`}
          </p>
          <section aria-labelledby="codes">
            <h2 id="codes" className="mb-1 font-semibold">
              Recovery codes
            </h2>
            <p className={`mb-3 text-sm ${left <= 2 ? "text-red-700 dark:text-red-300" : "text-zinc-600 dark:text-zinc-400"}`}>
              {left} unused code{left === 1 ? "" : "s"} left{left <= 2 ? ". Get new ones soon." : "."}
            </p>
            <CodeForm
              action={regenerateRecoveryCodesAction}
              label="Current code"
              submit="Get new recovery codes"
              hint="Enter a code from your app. The old recovery codes stop working."
              continueHref="/account/mfa"
            />
          </section>
          <section aria-labelledby="replace">
            <h2 id="replace" className="mb-1 font-semibold">
              Replace your authenticator
            </h2>
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">Moving to a new phone? Prove a current code, then scan a new key. Your other sessions will end.</p>
            <CodeForm action={startReenrolmentAction} label="Current code" submit="Continue" hint="A code from your app, or a recovery code." />
          </section>
          {isAdmin && !session.mfaRequired && (
            <section aria-labelledby="turn-off">
              <h2 id="turn-off" className="mb-1 font-semibold">
                Turn off MFA
              </h2>
              <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">Prove a current code to remove your authenticator and recovery codes. Your other sessions will end.</p>
              <CodeForm action={disableOwnMfaAction} label="Current code" submit="Turn off MFA" hint="A code from your app, or a recovery code." />
            </section>
          )}
        </div>
      )}
      <p className="mt-8 text-sm">
        <Link href="/" className="text-zinc-600 underline dark:text-zinc-400">
          Back to the board
        </Link>
      </p>
    </AuthCard>
  );
}
