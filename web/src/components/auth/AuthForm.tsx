"use client";

import { useActionState } from "react";
import type { FormState } from "@/auth/actions";

export interface AuthField {
  name: string;
  label: string;
  type: "email" | "password";
  autoComplete: string;
  hint?: string;
}

const input =
  "mt-1 block w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function AuthForm({
  action,
  fields,
  submit,
  hidden,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  fields: AuthField[];
  submit: string;
  /** Extra values sent with the form (for example the token from an emailed link). */
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  if (state.notice) {
    return (
      <p role="status" className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
        {state.notice}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {hidden && Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {state.error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {state.error}
        </p>
      )}
      {fields.map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name} className="block text-sm font-medium">
            {f.label}
          </label>
          <input
            id={f.name}
            name={f.name}
            type={f.type}
            autoComplete={f.autoComplete}
            defaultValue={f.type === "email" ? state.email : undefined}
            required
            aria-describedby={f.hint ? `${f.name}-hint` : undefined}
            className={input}
          />
          {f.hint && (
            <p id={`${f.name}-hint`} className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {f.hint}
            </p>
          )}
        </div>
      ))}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "Please wait…" : submit}
      </button>
    </form>
  );
}
