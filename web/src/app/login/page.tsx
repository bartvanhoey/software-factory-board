import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/auth/actions";
import { getAuthConfig } from "@/auth/config";
import { getSession } from "@/auth/dal";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Log in · Software Factory Board" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ verified?: string; reset?: string }> }) {
  if (await getSession()) redirect("/");
  const { verified, reset } = await searchParams;
  const mail = getAuthConfig().emailVerification;
  return (
    <AuthCard title="Log in">
      {(verified === "1" || reset === "1") && (
        <p role="status" className="mb-4 alert alert-success">
          {reset === "1" ? "Your password was changed. Log in with the new password." : "Your email address is confirmed. Log in to continue."}
        </p>
      )}
      <AuthForm
        action={loginAction}
        submit="Log in"
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "username" },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
        ]}
      />
      {mail && (
        <p className="mt-4 text-sm">
          <Link href="/forgot-password" className="text-muted underline">
            Forgot your password?
          </Link>
        </p>
      )}
      <p className="mt-6 text-sm text-muted">
        No account yet?{" "}
        <Link href="/register" className="link">
          Register
        </Link>
      </p>
    </AuthCard>
  );
}
