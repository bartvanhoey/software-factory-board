import Link from "next/link";
import type { BoardData } from "@/lib/types";
import { ThemeToggle } from "./ThemeToggle";

export function Header({ board, title = "Software Factory Board" }: { board: BoardData; title?: string }) {
  const time = new Date(board.fetchedAt).toLocaleTimeString("en-GB", { timeZone: "UTC" });
  return (
    <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
      <h1 className="text-xl font-semibold tracking-tight">
        <Link href="/">{title}</Link>
      </h1>
      <div className="flex items-center gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {board.source === "live" ? "Live from GitHub" : "Demo data"} · updated {time} UTC · refreshes every 30 s
        </p>
        <ThemeToggle />
      </div>
    </header>
  );
}

export function DemoBanner({ board }: { board: BoardData }) {
  if (board.source !== "demo") return null;
  return (
    <p
      role="status"
      className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
    >
      Showing demo data ({board.demoReason}). Set <code className="font-mono">GH_TOKEN</code> in{" "}
      <code className="font-mono">web/.env.local</code> to see the projects in{" "}
      <code className="font-mono">projects/</code>.
    </p>
  );
}
