import Link from "next/link";
import { requireAccess } from "@/auth/dal";
import { Board } from "@/components/Board";
import { DemoBanner, Header } from "@/components/Header";
import { ProjectChips, ProjectErrors } from "@/components/ProjectChips";
import { loadBoard } from "@/lib/data";
import { parseSelected, selectIssues } from "@/lib/lanes";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ project?: string | string[] }> }) {
  await requireAccess("viewer");
  const [board, params] = await Promise.all([loadBoard(), searchParams]);
  const selected = parseSelected(params.project);
  const now = new Date(board.fetchedAt);

  return (
    <main>
      <Header board={board} />
      <DemoBanner board={board} />
      <div className="mb-4 flex justify-end">
        <Link
          className="btn btn-primary"
          href={`/issues/new${selected.length === 1 ? `?project=${encodeURIComponent(selected[0]!)}` : ""}`}
        >
          Create issue
        </Link>
      </div>
      <ProjectChips projects={board.projects} selected={selected} />
      <ProjectErrors projects={board.projects} />
      <Board issues={selectIssues(board.projects, selected)} now={now} />
    </main>
  );
}
