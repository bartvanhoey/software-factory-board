import type { ReactNode } from "react";

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-[calc(100vh-10rem)] items-center justify-center py-6">
      <div className="card w-full max-w-sm p-6 sm:p-8">
        <h1 className="mb-6 text-xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}
