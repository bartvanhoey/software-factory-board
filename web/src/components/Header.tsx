import type { BoardData } from "@/lib/types";

/** Page heading with the board's data-source line. */
export function Header({ board, title = "Board" }: { board: BoardData; title?: string }) {
  const time = new Date(board.fetchedAt).toLocaleTimeString("en-GB", {
    timeZone: "UTC",
  });
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
      <h1 className="page-title">{title}</h1>
      <p className="flex items-center gap-2 text-sm text-muted">
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${board.source === "live" ? "bg-emerald-500" : "bg-amber-500"}`}
        />
        <span>
          {board.source === "live" ? "Live from GitHub" : "Demo data"} · updated {time} UTC
          <span className="max-sm:hidden"> · refreshes every 30 s</span>
        </span>
      </p>
    </header>
  );
}

export function DemoBanner({ board }: { board: BoardData }) {
  if (board.source !== "demo") return null;
  return (
    <p role="status" className="alert alert-warn mb-6">
      Showing demo data ({board.demoReason}). Set <code className="font-mono">BOARD_GITHUB_TOKEN</code> in{" "}
      <code className="font-mono">web/.env.local</code> to see the projects in <code className="font-mono">projects/</code>.
    </p>
  );
}
