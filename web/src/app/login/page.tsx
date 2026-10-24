import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/auth/actions";
import { getSession } from "@/auth/dal";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Log in · Software Factory Board" };

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <AuthCard title="Log in">
      <AuthForm
        action={loginAction}
        submit="Log in"
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "username" },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
        ]}
      />
      <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
        No account yet?{" "}
        <Link href="/register" className="font-medium underline">
          Register
        </Link>
      </p>
    </AuthCard>
  );
}
