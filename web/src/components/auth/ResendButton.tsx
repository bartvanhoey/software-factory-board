"use client";

import { useActionState } from "react";
import { resendVerificationAction } from "@/auth/email-actions";

export function ResendButton() {
  const [state, action, pending] = useActionState(resendVerificationAction, {});
  return (
    <form action={action} className="mt-4 space-y-3">
      {state.error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          {state.notice}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {pending ? "Sending…" : "Send me a new link"}
      </button>
    </form>
  );
}
