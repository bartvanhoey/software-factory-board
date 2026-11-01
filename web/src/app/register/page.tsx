import Link from "next/link";
import { redirect } from "next/navigation";
import { registerAction } from "@/auth/actions";
import { getSession } from "@/auth/dal";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Register · Software Factory Board" };

export default async function RegisterPage() {
  if (await getSession()) redirect("/");
  return (
    <AuthCard title="Register">
      <p className="mb-4 text-sm text-muted">
        A new account has no access until an administrator grants it a role.
      </p>
      <AuthForm
        action={registerAction}
        submit="Create account"
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "username" },
          { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: "12 to 128 characters." },
          { name: "confirm", label: "Repeat password", type: "password", autoComplete: "new-password" },
        ]}
      />
      <p className="mt-6 text-sm text-muted">
        Already registered?{" "}
        <Link href="/login" className="link">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
