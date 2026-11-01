import { redirect } from "next/navigation";
import { getAuthConfig } from "@/auth/config";
import { requireState } from "@/auth/dal";
import { getDb } from "@/auth/db";
import { pendingSetup } from "@/auth/mfa";
import { confirmSetupAction } from "@/auth/mfa-actions";
import { qrSvgPath } from "@/auth/qr";
import { AuthCard } from "@/components/auth/AuthCard";
import { CodeForm } from "@/components/auth/CodeForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up MFA · Software Factory Board" };

export default async function MfaSetupPage() {
  const session = await requireState("/account/mfa/setup");
  const view = pendingSetup(getDb(), getAuthConfig().mfaKey, session.userId, session.tokenHash);
  // Someone who already has MFA must prove a current code first (on /account/mfa) before a new secret is made.
  if (!view) redirect("/account/mfa");
  const { size, d } = qrSvgPath(view.uri);
  const pad = 2;

  return (
    <AuthCard title="Set up your authenticator">
      <CodeForm
        action={confirmSetupAction}
        label="6-digit code"
        submit="Turn on MFA"
        continueHref="/"
        intro={
          <>
            {session.needsMfaSetup && (
              <p role="status" className="mb-4 alert alert-warn">
                MFA is required for your account. Set it up to continue.
              </p>
            )}
            <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>Open an authenticator app (any app that supports one-time codes) and add an account.</li>
              <li>Scan this code, or type the key below.</li>
              <li>Enter the 6-digit code the app shows to confirm.</li>
            </ol>
            <svg
              role="img"
              aria-label="QR code for your authenticator app"
              viewBox={`${-pad} ${-pad} ${size + 2 * pad} ${size + 2 * pad}`}
              shapeRendering="crispEdges"
              className="mb-3 h-56 w-56 rounded-lg border border-line bg-white p-2"
            >
              <path d={d} fill="#000" />
            </svg>
            <p className="mb-4 text-sm">
              Key: <code className="select-all break-all font-mono">{view.secret}</code>
            </p>
          </>
        }
      />
    </AuthCard>
  );
}
