"use client";

import { useActionState, useId } from "react";
import type { FormState } from "@/auth/actions";

export interface AuthField {
  name: string;
  label: string;
  type: "email" | "password";
  autoComplete: string;
  hint?: string;
}

const input =
  "input mt-1";

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
  const errorId = useId();

  if (state.notice) {
    return (
      <p role="status" className="alert alert-success">
        {state.notice}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {hidden && Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {state.error && (
        <p id={errorId} role="alert" className="alert alert-error">
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
            aria-invalid={state.error ? true : undefined}
            aria-describedby={[f.hint ? `${f.name}-hint` : null, state.error ? errorId : null].filter(Boolean).join(" ") || undefined}
            className={input}
          />
          {f.hint && (
            <p id={`${f.name}-hint`} className="mt-1 text-xs text-muted">
              {f.hint}
            </p>
          )}
        </div>
      ))}
      <button
        type="submit"
        disabled={pending}
        className="w-full btn btn-primary btn-block"
      >
        {pending ? "Please wait…" : submit}
      </button>
    </form>
  );
}
