import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthConfig } from "@/auth/config";
import { forgotPasswordAction } from "@/auth/email-actions";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Forgot password · Software Factory Board" };

export default function ForgotPasswordPage() {
  if (!getAuthConfig().emailVerification) notFound();
  return (
    <AuthCard title="Forgot your password?">
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">Enter the email address of your account and we will send you a link to choose a new password.</p>
      <AuthForm
        action={forgotPasswordAction}
        submit="Send me a link"
        fields={[{ name: "email", label: "Email", type: "email", autoComplete: "username" }]}
      />
      <p className="mt-6 text-sm">
        <Link href="/login" className="text-zinc-600 underline dark:text-zinc-400">
          Back to log in
        </Link>
      </p>
    </AuthCard>
  );
}
