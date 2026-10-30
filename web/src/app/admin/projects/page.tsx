import { requireAccess } from "@/auth/dal";
import { getDb } from "@/auth/db";
import { listProjects } from "@/auth/projects";
import { hasRole } from "@/auth/users";
import { EnableButton, NEW_PROJECT, ProjectForm } from "@/components/admin/ProjectForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects · Software Factory Board" };

const summary = "cursor-pointer text-sm font-medium hover:underline";

export default async function ProjectsPage() {
  const session = await requireAccess("issue-admin");
  const isAdmin = hasRole(session.roles, "admin");
  const projects = listProjects(getDb());

  return (
    <main>
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Projects</h1>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        The GitHub repositories the factory works on. {isAdmin ? "You switch a project on and set its commands." : "A project you add stays off until an Administrator switches it on."}{" "}
        A project is switched off, never removed, so its history stays.
      </p>

      <details className="mb-6 rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <summary className={summary}>Add a project</summary>
        <div className="mt-3">
          <ProjectForm mode="create" values={NEW_PROJECT} isAdmin={isAdmin} />
        </div>
      </details>

      {projects.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No projects yet.</p>
      ) : (
        <ul className="space-y-3">
          {projects.map((p) => (
            <li key={p.name} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-medium">{p.name}</h2>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    {p.repo} · {p.defaultBranch} · {p.stack} · lanes: {(["build", "qa", "review"] as const).filter((l) => p.lanes[l]).join(", ") || "none"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${p.enabled ? "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"}`}
                  >
                    {p.enabled ? "on" : "off"}
                  </span>
                  <EnableButton name={p.name} enabled={p.enabled} version={p.version} isAdmin={isAdmin} />
                </div>
              </div>
              <details className="mt-3">
                <summary className={summary}>Edit</summary>
                <div className="mt-3">
                  <ProjectForm
                    mode="edit"
                    isAdmin={isAdmin}
                    locked={!isAdmin && p.enabled}
                    values={{ name: p.name, repo: p.repo, defaultBranch: p.defaultBranch, stack: p.stack, lanes: p.lanes, limits: p.limits, commands: p.commands, enabled: p.enabled, version: p.version }}
                  />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
