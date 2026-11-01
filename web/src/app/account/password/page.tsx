import { changePasswordAction } from "@/auth/actions";
import { requireUser } from "@/auth/dal";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Change password · Software Factory Board" };

export default async function PasswordPage() {
  const session = await requireUser();
  return (
    <AuthCard title="Change password">
      {session.mustChangePassword && (
        <p role="status" className="mb-4 alert alert-warn">
          You must choose a new password before you continue.
        </p>
      )}
      <AuthForm
        action={changePasswordAction}
        submit="Change password"
        fields={[
          { name: "current", label: "Current password", type: "password", autoComplete: "current-password" },
          { name: "next", label: "New password", type: "password", autoComplete: "new-password", hint: "12 to 128 characters." },
          { name: "confirm", label: "Repeat new password", type: "password", autoComplete: "new-password" },
        ]}
      />
    </AuthCard>
  );
}
