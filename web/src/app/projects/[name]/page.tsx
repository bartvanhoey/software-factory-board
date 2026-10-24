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
      <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
        <Link href="/" className="hover:underline">
          ← all projects
        </Link>
        <a href={`https://github.com/${info.repo}`} className="font-medium hover:underline">
          {info.repo}
        </a>
        <span>{info.stack}</span>
        <span>{info.hasTests ? "has tests" : "no tests"}</span>
      </p>
      {project.status === "ok" && <Board issues={project.issues} now={new Date(board.fetchedAt)} />}
      {project.status === "error" && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          Could not load this project: {project.error}
        </p>
      )}
      {project.status === "disabled" && <p className="text-sm text-zinc-500">This project is disabled in its registry file.</p>}
    </main>
  );
}
