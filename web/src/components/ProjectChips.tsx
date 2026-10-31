import Link from "next/link";
import { toggleProject } from "@/lib/lanes";
import type { ProjectResult } from "@/lib/types";
import { projectColor } from "./projectColor";

function hrefFor(selected: readonly string[]): string {
  return selected.length === 0 ? "/" : `/?project=${selected.map(encodeURIComponent).join(",")}`;
}

export function ProjectChips({ projects, selected }: { projects: readonly ProjectResult[]; selected: readonly string[] }) {
  return (
    <nav aria-label="Filter by project" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
      <Link
        href="/"
        aria-current={selected.length === 0 ? "true" : undefined}
        className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-2 text-sm sm:py-1 ${
          selected.length === 0
            ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
            : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        }`}
      >
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
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-sm sm:py-1 ${
              isSelected
                ? "border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            } ${p.status === "disabled" ? "opacity-60" : ""}`}
          >
            <span className={`size-2 rounded-full ${projectColor(p.info.name).dot}`} aria-hidden="true" />
            {p.info.name}
            {p.status === "ok" && <span className="text-zinc-500 dark:text-zinc-400">{open} open</span>}
            {p.status === "error" && <span className="font-medium text-red-700 dark:text-red-400">error</span>}
            {p.status === "disabled" && <span className="text-zinc-500 dark:text-zinc-400">disabled</span>}
            {!p.info.hasTests && p.status !== "disabled" && (
              <span className="rounded bg-zinc-200 px-1.5 text-xs text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
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
      className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
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
