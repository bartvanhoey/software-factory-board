import type { ReactNode } from "react";

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto mt-12 max-w-sm">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">{title}</h1>
      {children}
    </main>
  );
}
