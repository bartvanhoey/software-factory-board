"use client";

import { useActionState } from "react";
import { resendVerificationAction } from "@/auth/email-actions";

export function ResendButton() {
  const [state, action, pending] = useActionState(resendVerificationAction, {});
  return (
    <form action={action} className="mt-4 space-y-3">
      {state.error && (
        <p role="alert" className="alert alert-error">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="alert alert-success">
          {state.notice}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="btn"
      >
        {pending ? "Sending…" : "Send me a new link"}
      </button>
    </form>
  );
}
