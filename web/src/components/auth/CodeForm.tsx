"use client";

import Link from "next/link";
import { useActionState, useId, type ReactNode } from "react";
import type { MfaState } from "@/auth/mfa-actions";

const input =
  "input mt-1 font-mono tracking-wider";

function RecoveryCodes({ codes, continueHref }: { codes: string[]; continueHref: string }) {
  return (
    <section aria-labelledby="codes-title" className="space-y-3">
      <h2 id="codes-title" className="font-semibold">
        Save your recovery codes
      </h2>
      <p className="text-sm text-muted">
        Each code works once if you lose your authenticator. They are shown only now, so store them somewhere safe, apart from your password.
      </p>
      <ol className="grid grid-cols-2 gap-x-6 gap-y-1 card p-4 font-mono text-sm">
        {codes.map((c) => (
          <li key={c} className="select-all">
            {c}
          </li>
        ))}
      </ol>
      <Link href={continueHref} className="btn btn-primary">
        I have saved them, continue
      </Link>
    </section>
  );
}

/** One code field. Used to log in, to confirm a new authenticator and to prove a current code before a change. */
export function CodeForm({
  action,
  label,
  submit,
  hint,
  intro,
  continueHref = "/",
}: {
  action: (prev: MfaState, form: FormData) => Promise<MfaState>;
  label: string;
  submit: string;
  hint?: string;
  /** Shown above the form and removed from the screen with it once the recovery codes appear (the page is never cached). */
  intro?: ReactNode;
  continueHref?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  // Two of these forms share a page on /account/mfa, so ids must be unique or the labels point at the wrong field.
  const id = useId();
  if (state.recoveryCodes) return <RecoveryCodes codes={state.recoveryCodes} continueHref={continueHref} />;

  return (
    <>
    {intro}
    <form action={formAction} className="space-y-3">
      {state.error && (
        <p role="alert" className="alert alert-error">
          {state.error}
        </p>
      )}
      <div>
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        <input
          id={id}
          name="code"
          type="text"
          inputMode="text"
          autoComplete="one-time-code"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          maxLength={32}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={input}
        />
        {hint && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
            {hint}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full btn btn-primary btn-block"
      >
        {pending ? "Please wait…" : submit}
      </button>
    </form>
    </>
  );
}
