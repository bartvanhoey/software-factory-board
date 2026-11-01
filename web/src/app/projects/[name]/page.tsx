import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/auth/dal";
import { Board } from "@/components/Board";
import { DemoBanner, Header } from "@/components/Header";
import { loadBoard } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ name: string }> }) {
  await requireAccess("viewer");
  const { name } = await params;
  const board = await loadBoard();
  const project = board.projects.find((p) => p.info.name === decodeURIComponent(name));
  if (!project) notFound();
  const { info } = project;

  return (
    <main>
      <Header board={board} title={info.name} />
      <DemoBanner board={board} />
      <p className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
        <Link href="/" className="link">
          ← all projects
        </Link>
        <a href={`https://github.com/${info.repo}`} className="link">
          {info.repo}
        </a>
        <span className="badge badge-neutral">{info.stack}</span>
        <span className={`badge ${info.hasTests ? "badge-ok" : "badge-warn"}`}>{info.hasTests ? "has tests" : "no tests"}</span>
      </p>
      {project.status === "ok" && <Board issues={project.issues} now={new Date(board.fetchedAt)} />}
      {project.status === "error" && (
        <p role="alert" className="alert alert-error">
          Could not load this project: {project.error}
        </p>
      )}
      {project.status === "disabled" && <p className="card p-8 text-center text-sm text-muted">This project is switched off.</p>}
    </main>
  );
}
