"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main role="alert" className="alert alert-error mx-auto max-w-xl p-5">
      <h1 className="text-base font-semibold">The board could not be loaded</h1>
      <p className="mt-1 whitespace-pre-wrap text-sm">{error.message}</p>
      <button onClick={reset} className="btn btn-sm mt-4">
        Try again
      </button>
    </main>
  );
}
