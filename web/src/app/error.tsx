"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      <h1 className="font-semibold">The board could not be loaded</h1>
      <p className="mt-1 whitespace-pre-wrap text-sm">{error.message}</p>
      <button onClick={reset} className="mt-3 rounded border border-red-400 px-3 py-1 text-sm hover:bg-red-100 dark:hover:bg-red-900">
        Try again
      </button>
    </main>
  );
}
