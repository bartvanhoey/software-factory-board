import Link from "next/link";
import { toggleProject } from "@/lib/lanes";
import type { ProjectResult } from "@/lib/types";
import { projectColor } from "./projectColor";

function hrefFor(selected: readonly string[]): string {
  return selected.length === 0 ? "/" : `/?project=${selected.map(encodeURIComponent).join(",")}`;
}

/** A tick on the selected chip, so the state is not shown by colour alone (WCAG 1.4.1). */
function Check() {
  return (
    <svg viewBox="0 0 16 16" className="-ml-0.5 size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

export function ProjectChips({ projects, selected }: { projects: readonly ProjectResult[]; selected: readonly string[] }) {
  return (
    <nav aria-label="Filter by project" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
      <Link
        href="/"
        aria-current={selected.length === 0 ? "true" : undefined}
        className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium transition-colors sm:py-1 ${
          selected.length === 0
            ? "border-accent bg-accent text-accent-fg"
            : "border-line-strong bg-surface text-muted hover:bg-subtle hover:text-fg"
        }`}
      >
        {selected.length === 0 && <Check />}
        All projects
      </Link>
      {projects.map((p) => {
        const isSelected = selected.includes(p.info.name);
        const open = p.status === "ok" ? p.issues.filter((i) => i.lane !== "done").length : 0;
        return (
          <Link
            key={p.info.name}
            href={hrefFor(toggleProject(selected, p.info.name))}
            aria-current={isSelected ? "true" : undefined}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium transition-colors sm:py-1 ${
              isSelected
                ? "border-accent bg-accent-soft text-accent-soft-fg"
                : "border-line-strong bg-surface text-muted hover:bg-subtle hover:text-fg"
            } ${p.status === "disabled" ? "border-dashed" : ""}`}
          >
            {isSelected && <Check />}
            <span className={`size-2 rounded-full ${projectColor(p.info.name).dot}`} aria-hidden="true" />
            {p.info.name}
            {p.status === "ok" && <span className="font-normal">{open} open</span>}
            {p.status === "error" && <span className="badge badge-bad">error</span>}
            {p.status === "disabled" && <span className="font-normal">disabled</span>}
            {!p.info.hasTests && p.status !== "disabled" && (
              <span className="badge badge-neutral">
                no tests
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function ProjectErrors({ projects }: { projects: readonly ProjectResult[] }) {
  const failed = projects.filter((p) => p.status === "error");
  if (failed.length === 0) return null;
  return (
    <div
      role="alert"
      className="mb-4 alert alert-error"
    >
      <p className="font-medium">
        {failed.length} project{failed.length === 1 ? "" : "s"} could not be loaded:
      </p>
      <ul className="mt-1 list-disc pl-5">
        {failed.map((p) => (
          <li key={p.info.name}>
            <span className="font-medium">{p.info.name}</span> ({p.info.repo}):{" "}
            {p.status === "error" ? p.error : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
