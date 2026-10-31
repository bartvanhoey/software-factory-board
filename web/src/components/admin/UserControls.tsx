"use client";

import { useActionState, useEffect, useState } from "react";
import { BREAKGLASS_RESET_MFA } from "@/auth/breakglass-hint";
import { markEmailVerifiedAction, resetMfaAction, resetPasswordAction, saveRolesAction, setDisabledAction, setMfaRequiredAction, type AdminState } from "@/auth/admin-actions";

const ROLES = ["admin", "issue-admin", "viewer"] as const;
const HIDE_AFTER_MS = 60_000;
const button =
  "rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800";

/** The plaintext is removed from the screen after a minute or on request, so an unattended page does not keep it. */
function TemporaryPassword({ value }: { value: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return <p className="mt-1">Temporary password hidden. Reset again to get a new one.</p>;
  return (
    <p className="mt-1">
      Temporary password: <code className="select-all rounded bg-amber-100 px-1 py-0.5 font-mono text-sm text-amber-950 dark:bg-amber-900 dark:text-amber-100">{value}</code>{" "}
      <button type="button" onClick={() => setVisible(false)} className="underline">
        Hide
      </button>
    </p>
  );
}

function Feedback({ state }: { state: AdminState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
        {state.error}
      </p>
    );
  }
  if (!state.message) return null;
  return (
    <div role="status" className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
      <p>{state.message}</p>
      {state.temporaryPassword && <TemporaryPassword key={state.temporaryPassword} value={state.temporaryPassword} />}
    </div>
  );
}

export function UserControls({
  id,
  email,
  roles,
  disabled,
  isSelf,
  mfaEnabled,
  mfaRequired,
  emailVerified,
  emailVerification,
}: {
  id: string;
  email: string;
  roles: string[];
  disabled: boolean;
  isSelf: boolean;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  emailVerified: boolean;
  /** EMAIL_VERIFICATION is on, so an unconfirmed address matters. */
  emailVerification: boolean;
}) {
  const [rolesState, rolesAction, rolesPending] = useActionState(saveRolesAction, {});
  const [disableState, disableAction, disablePending] = useActionState(setDisabledAction, {});
  const [resetState, resetAction, resetPending] = useActionState(resetPasswordAction, {});
  const [requireState, requireAction, requirePending] = useActionState(setMfaRequiredAction, {});
  const [resetMfaState, resetMfaFormAction, resetMfaPending] = useActionState(resetMfaAction, {});
  const [emailState, emailAction, emailPending] = useActionState(markEmailVerifiedAction, {});
  const isAdmin = roles.includes("admin");
  const requireForm = (
    <form action={requireAction}>
      <input type="hidden" name="userId" value={id} />
      <input type="hidden" name="required" value={mfaRequired ? "false" : "true"} />
      <button type="submit" disabled={requirePending} className={button}>
        {mfaRequired ? "Stop requiring MFA" : "Require MFA"}
      </button>
      <Feedback state={requireState} />
    </form>
  );

  return (
    <div className="space-y-2">
      <form action={rolesAction}>
        <input type="hidden" name="userId" value={id} />
        {/* What this admin saw. If someone changed the roles meanwhile, the save is refused, not merged. */}
        <input type="hidden" name="expected" value={roles.join(",")} />
        <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <legend className="sr-only">Roles for {email}</legend>
          {ROLES.map((role) => {
            const lockedAdmin = isSelf && role === "admin";
            return (
              <label key={role} className="flex items-center gap-1 text-xs">
                <input type="checkbox" name="roles" value={role} defaultChecked={roles.includes(role)} disabled={lockedAdmin} />
                {role}
              </label>
            );
          })}
          {/* A disabled checkbox is not submitted; keep the admin role in the form for your own row. */}
          {isSelf && <input type="hidden" name="roles" value="admin" />}
          <button type="submit" disabled={rolesPending} className={button}>
            Save roles
          </button>
        </fieldset>
        <Feedback state={rolesState} />
      </form>

      {isSelf ? (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            This is you: you cannot remove your own admin role, disable yourself or reset your own password here. Stopping the MFA requirement keeps your authenticator; turn that off at <code className="font-mono">/account/mfa</code>.
          </p>
          {requireForm}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <form action={disableAction}>
            <input type="hidden" name="userId" value={id} />
            <input type="hidden" name="disabled" value={disabled ? "false" : "true"} />
            <button type="submit" disabled={disablePending} className={button}>
              {disabled ? "Enable" : "Disable"}
            </button>
            <Feedback state={disableState} />
          </form>
          <form action={resetAction}>
            <input type="hidden" name="userId" value={id} />
            <button type="submit" disabled={resetPending} className={button}>
              Reset password
            </button>
            <Feedback state={resetState} />
          </form>
          {emailVerification && !emailVerified && (
            <form action={emailAction}>
              <input type="hidden" name="userId" value={id} />
              <button type="submit" disabled={emailPending} className={button}>
                Mark email confirmed
              </button>
              <Feedback state={emailState} />
            </form>
          )}
          {requireForm}
          {isAdmin ? (
            <p className="basis-full text-xs text-zinc-500 dark:text-zinc-400">Stopping the requirement keeps an admin&apos;s authenticator. An admin&apos;s MFA can only be reset from the server:<code className="font-mono">{BREAKGLASS_RESET_MFA}</code>
            </p>
          ) : (
            mfaEnabled && (
              <form action={resetMfaFormAction}>
                <input type="hidden" name="userId" value={id} />
                <button type="submit" disabled={resetMfaPending} className={button}>
                  Reset MFA
                </button>
                <Feedback state={resetMfaState} />
              </form>
            )
          )}
        </div>
      )}
    </div>
  );
}
