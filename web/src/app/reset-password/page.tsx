import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthConfig } from "@/auth/config";
import { getDb } from "@/auth/db";
import { resetPasswordAction } from "@/auth/email-actions";
import { tokenIsLive } from "@/auth/email-tokens";
import { INVALID_LINK } from "@/auth/verification";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthForm } from "@/components/auth/AuthForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a new password · Software Factory Board" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  if (!getAuthConfig().emailVerification) notFound();
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";

  if (!tokenIsLive(getDb(), token, "reset")) {
    return (
      <AuthCard title="This link does not work">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{INVALID_LINK}</p>
        <p className="mt-4 text-sm">
          <Link href="/forgot-password" className="font-medium underline">
            Ask for a new link
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        This ends all your logins on other devices. If you use multi-factor authentication you will still need your code to log in.
      </p>
      <AuthForm
        action={resetPasswordAction}
        submit="Change password"
        hidden={{ token }}
        fields={[
          { name: "next", label: "New password", type: "password", autoComplete: "new-password", hint: "12 to 128 characters." },
          { name: "confirm", label: "Repeat new password", type: "password", autoComplete: "new-password" },
        ]}
      />
    </AuthCard>
  );
}
