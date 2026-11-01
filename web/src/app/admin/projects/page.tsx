import { requireAccess } from "@/auth/dal";
import { getDb } from "@/auth/db";
import { listProjects } from "@/auth/projects";
import { hasRole } from "@/auth/users";
import { ArchiveButton, EnableButton, NEW_PROJECT, ProjectForm } from "@/components/admin/ProjectForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects · Software Factory Board" };

const summary = "cursor-pointer text-sm font-medium select-none hover:text-accent";

export default async function ProjectsPage() {
  const session = await requireAccess("issue-admin");
  const isAdmin = hasRole(session.roles, "admin");
  const projects = listProjects(getDb());
  const archived = isAdmin ? listProjects(getDb(), true) : [];

  return (
    <main>
      <h1 className="page-title">Projects</h1>
      <p className="page-lead">
        The GitHub repositories the factory works on. {isAdmin ? "You switch a project on and set its commands." : "A project you add stays off until an Administrator switches it on."}{" "}
        A project is switched off or archived, never removed, so its history stays.
      </p>

      <details className="panel mb-6">
        <summary className={summary}>Add a project</summary>
        <div className="mt-3">
          <ProjectForm mode="create" values={NEW_PROJECT} isAdmin={isAdmin} />
        </div>
      </details>

      {projects.length === 0 ? (
        <p className="card p-8 text-center text-sm text-muted">No projects yet.</p>
      ) : (
        <ul className="space-y-3">
          {projects.map((p) => (
            <li key={p.name} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{p.name}</h2>
                  <p className="mt-0.5 text-xs text-muted">
                    {p.repo} · {p.defaultBranch} · {p.stack} · lanes: {(["build", "qa", "review"] as const).filter((l) => p.lanes[l]).join(", ") || "none"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`badge ${p.enabled ? "badge-ok" : "badge-neutral"}`}
                  >
                    {p.enabled ? "on" : "off"}
                  </span>
                  <EnableButton name={p.name} enabled={p.enabled} version={p.version} isAdmin={isAdmin} />
                  {isAdmin && !p.enabled && <ArchiveButton name={p.name} archived={false} version={p.version} />}
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

      {archived.length > 0 && (
        <details className="panel mt-6">
          <summary className={summary}>Archived ({archived.length})</summary>
          <ul className="mt-3 space-y-3">
            {archived.map((p) => (
              <li key={p.name} className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{p.name}</h2>
                  <p className="mt-0.5 text-xs text-muted">{p.repo}</p>
                </div>
                <ArchiveButton name={p.name} archived version={p.version} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
