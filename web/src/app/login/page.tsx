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
        <p role="status" className="mb-4 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
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
          <Link href="/forgot-password" className="text-zinc-600 underline dark:text-zinc-400">
            Forgot your password?
          </Link>
        </p>
      )}
      <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
        No account yet?{" "}
        <Link href="/register" className="font-medium underline">
          Register
        </Link>
      </p>
    </AuthCard>
  );
}
