"use client";

import Link from "next/link";
import { useActionState, useId, type ReactNode } from "react";
import type { MfaState } from "@/auth/mfa-actions";

const input =
  "mt-1 block w-full rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-sm tracking-wider dark:border-zinc-700 dark:bg-zinc-900";

function RecoveryCodes({ codes, continueHref }: { codes: string[]; continueHref: string }) {
  return (
    <section aria-labelledby="codes-title" className="space-y-3">
      <h2 id="codes-title" className="font-semibold">
        Save your recovery codes
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Each code works once if you lose your authenticator. They are shown only now, so store them somewhere safe, apart from your password.
      </p>
      <ol className="grid grid-cols-2 gap-x-6 gap-y-1 rounded border border-zinc-300 bg-white p-3 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900">
        {codes.map((c) => (
          <li key={c} className="select-all">
            {c}
          </li>
        ))}
      </ol>
      <Link href={continueHref} className="inline-block rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
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
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
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
          <p id={`${id}-hint`} className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {hint}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "Please wait…" : submit}
      </button>
    </form>
    </>
  );
}
