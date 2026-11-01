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

const LANE_DOTS: Record<Lane, string> = {
  ready: "bg-zinc-400",
  building: "bg-sky-500",
  qa: "bg-violet-500",
  review: "bg-amber-500",
  done: "bg-emerald-500",
};

const LANE_HINTS: Record<Lane, string> = {
  ready: "waiting for a builder",
  building: "agent is working",
  qa: "being tested",
  review: "waiting for a human",
  done: `closed in the last ${DONE_WINDOW_DAYS} days`,
};

const CHECKS: Record<ChecksState, { label: string; className: string } | null> = {
  success: { label: "checks passing", className: "badge badge-ok" },
  failure: { label: "checks failing", className: "badge badge-bad" },
  pending: { label: "checks running", className: "badge badge-warn" },
  none: null,
};

function Card({ issue, now }: { issue: BoardIssue; now: Date }) {
  const checks = issue.pr ? CHECKS[issue.pr.checks] : null;
  return (
    <article className={`card border-l-[3px] p-3.5 text-sm transition-shadow hover:shadow-md ${projectColor(issue.project).card}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={`badge min-w-0 truncate ${projectColor(issue.project).badge}`}>
          {issue.project}
        </span>
        <a href={issue.url} className="shrink-0 text-xs text-muted hover:text-fg hover:underline">
          #{issue.number}
        </a>
      </div>
      <h3 className="font-medium leading-snug text-fg">
        <a href={issue.url} className="hover:underline">
          {issue.title}
        </a>
      </h3>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span>{issue.assignee ? `@${issue.assignee}` : "unassigned"}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={issue.updatedAt}>{timeAgo(issue.updatedAt, now)}</time>
      </p>
      {issue.pr && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs">
          <a href={issue.pr.url} className="font-medium hover:underline">
            PR #{issue.pr.number}
          </a>
          <span className="text-muted">
            {issue.pr.merged ? "merged" : issue.pr.draft ? "draft" : "approved, ready to merge"}
          </span>
          {checks && <span className={checks.className}>{checks.label}</span>}
        </p>
      )}
      {issue.branch && !issue.pr && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs">
          <span className="font-medium">branch {issue.branch.name}</span>
          <a href={issue.branch.compareUrl} className="text-muted hover:text-fg hover:underline">
            compare
          </a>
          <span className="text-muted">no PR until approved</span>
        </p>
      )}
      {issue.laneConflict && (
        <p className="badge badge-warn mt-2">
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
          className="min-w-[85%] flex-1 snap-start rounded-2xl border border-line bg-subtle/60 p-3 sm:min-w-72"
        >
          <header className="mb-3 px-1">
            <h2 id={`lane-${lane}`} className="flex items-center gap-2 text-sm font-semibold">
              <span aria-hidden="true" className={`size-2 rounded-full ${LANE_DOTS[lane]}`} />
              {LANE_TITLES[lane]}
              <span className="badge badge-neutral ml-auto bg-surface">{grouped[lane].length}</span>
            </h2>
            <p className="mt-0.5 text-xs text-muted">{LANE_HINTS[lane]}</p>
          </header>
          <div className="flex flex-col gap-2">
            {grouped[lane].length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong py-6 text-center text-xs text-muted">nothing here</p>
            ) : (
              grouped[lane].map((issue) => <Card key={`${issue.project}#${issue.number}`} issue={issue} now={now} />)
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
