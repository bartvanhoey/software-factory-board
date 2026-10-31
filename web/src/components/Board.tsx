import { groupByLane, timeAgo } from "@/lib/lanes";
import { DONE_WINDOW_DAYS, LANES, type BoardIssue, type ChecksState, type Lane } from "@/lib/types";
import { projectColor } from "./projectColor";

const LANE_TITLES: Record<Lane, string> = {
  ready: "Ready",
  building: "Building",
  qa: "QA",
  review: "Review",
  done: "Done",
};

const LANE_HINTS: Record<Lane, string> = {
  ready: "waiting for a builder",
  building: "agent is working",
  qa: "being tested",
  review: "waiting for a human",
  done: `closed in the last ${DONE_WINDOW_DAYS} days`,
};

const CHECKS: Record<ChecksState, { label: string; className: string } | null> = {
  success: { label: "checks passing", className: "text-emerald-700 dark:text-emerald-400" },
  failure: { label: "checks failing", className: "text-red-700 dark:text-red-400" },
  pending: { label: "checks running", className: "text-amber-700 dark:text-amber-400" },
  none: null,
};

function Card({ issue, now }: { issue: BoardIssue; now: Date }) {
  const checks = issue.pr ? CHECKS[issue.pr.checks] : null;
  return (
    <article className={`rounded-lg border p-3 text-sm shadow-sm ${projectColor(issue.project).card}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={`truncate rounded px-1.5 py-0.5 text-xs font-medium ${projectColor(issue.project).badge}`}>
          {issue.project}
        </span>
        <a href={issue.url} className="shrink-0 text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          #{issue.number}
        </a>
      </div>
      <h3 className="font-medium leading-snug">
        <a href={issue.url} className="hover:underline">
          {issue.title}
        </a>
      </h3>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span>{issue.assignee ? `@${issue.assignee}` : "unassigned"}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={issue.updatedAt}>{timeAgo(issue.updatedAt, now)}</time>
      </p>
      {issue.pr && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs">
          <a href={issue.pr.url} className="font-medium hover:underline">
            PR #{issue.pr.number}
          </a>
          <span className="text-zinc-500 dark:text-zinc-400">
            {issue.pr.merged ? "merged" : issue.pr.draft ? "draft" : "approved, ready to merge"}
          </span>
          {checks && <span className={checks.className}>{checks.label}</span>}
        </p>
      )}
      {issue.branch && !issue.pr && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs">
          <span className="font-medium">branch {issue.branch.name}</span>
          <a href={issue.branch.compareUrl} className="text-zinc-500 hover:underline dark:text-zinc-400">
            compare
          </a>
          <span className="text-zinc-500 dark:text-zinc-400">no PR until approved</span>
        </p>
      )}
      {issue.laneConflict && (
        <p className="mt-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          ⚠ more than one lane label on this issue
        </p>
      )}
    </article>
  );
}

export function Board({ issues, now }: { issues: readonly BoardIssue[]; now: Date }) {
  const grouped = groupByLane(issues);
  return (
    <div className="flex snap-x gap-4 overflow-x-auto pb-4">
      {LANES.map((lane) => (
        <section
          key={lane}
          aria-labelledby={`lane-${lane}`}
          className="min-w-72 flex-1 snap-start rounded-xl bg-zinc-100 p-3 dark:bg-zinc-900/60"
        >
          <header className="mb-3">
            <h2 id={`lane-${lane}`} className="flex items-center justify-between text-sm font-semibold">
              {LANE_TITLES[lane]}
              <span className="rounded-full bg-zinc-200 px-2 text-xs font-medium dark:bg-zinc-800">
                {grouped[lane].length}
              </span>
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{LANE_HINTS[lane]}</p>
          </header>
          <div className="flex flex-col gap-2">
            {grouped[lane].length === 0 ? (
              <p className="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">nothing here</p>
            ) : (
              grouped[lane].map((issue) => <Card key={`${issue.project}#${issue.number}`} issue={issue} now={now} />)
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
