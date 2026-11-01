import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthConfig } from "@/auth/config";
import { getDb } from "@/auth/db";
import { confirmEmailAction } from "@/auth/email-actions";
import { getSession } from "@/auth/dal";
import { peekToken } from "@/auth/email-tokens";
import { INVALID_LINK } from "@/auth/verification";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthForm } from "@/components/auth/AuthForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirm your email · Software Factory Board" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  if (!getAuthConfig().emailVerification) notFound();
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";

  const live = peekToken(getDb(), token, "verify");
  if (!live) {
    return (
      <AuthCard title="This link does not work">
        <p className="text-sm text-muted">{INVALID_LINK}</p>
        <p className="mt-4 text-sm">
          <Link href="/login" className="link">
            Log in
          </Link>{" "}
          to ask for a new one.
        </p>
      </AuthCard>
    );
  }

  // Confirming needs the inbox AND the account's own login. Without that, a stranger could register your address with a
  // password they know and your click on the link in your own inbox would confirm their account for them.
  const session = await getSession();
  if (!session || session.mfaPending || session.userId !== live.userId) {
    return (
      <AuthCard title="Log in to confirm">
        <p className="text-sm text-muted">
          This link confirms the email address of an account. Log in to that account first, then open the link again, so we know it is you.
        </p>
        <p className="mt-4 text-sm text-muted">
          Did not create an account? Do not log in: ignore this email. If an account already exists for your address and it is not yours, use{" "}
          <Link href="/forgot-password" className="link">
            Forgot your password?
          </Link>{" "}
          to take it over.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/login" className="link">
            Log in
          </Link>
        </p>
      </AuthCard>
    );
  }

  // Opening the link only shows this button. Confirming is a POST, because mail scanners open links before people do
  // and a GET that confirmed would use the link up.
  return (
    <AuthCard title="Confirm your email address">
      <p className="mb-4 text-sm text-muted">Press the button to confirm that this address is yours.</p>
      <AuthForm action={confirmEmailAction} fields={[]} submit="Confirm my email" hidden={{ token }} />
    </AuthCard>
  );
}
