import Link from "next/link";
import { listAudit } from "@/auth/admin";
import { requireAccess } from "@/auth/dal";
import { getDb } from "@/auth/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log · Software Factory Board" };

type Params = { action?: string | string[]; user?: string | string[]; before?: string | string[] };

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

/** On a phone each row is a card and each cell shows its column name (from data-label) in front of its value. */
const cell = "max-md:flex max-md:gap-3 max-md:py-1 max-md:pr-0 max-md:before:w-20 max-md:before:shrink-0 max-md:before:text-xs max-md:before:uppercase max-md:before:text-muted max-md:before:content-[attr(data-label)]";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  const admin = await requireAccess("admin");
  const params = await searchParams;
  const action = first(params.action)?.slice(0, 64) || undefined;
  const user = first(params.user)?.slice(0, 254) || undefined;
  const beforeRaw = Number(first(params.before));
  const before = Number.isSafeInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : undefined;

  const { items, next, actions } = listAudit(getDb(), admin.userId, { action, user, before });

  const older = new URLSearchParams();
  if (action) older.set("action", action);
  if (user) older.set("user", user);
  if (next) older.set("before", String(next));

  const field = "input mt-1 sm:w-auto";
  return (
    <main>
      <h1 className="page-title">Audit log</h1>
      <p className="page-lead">Newest first, times in UTC. Entries cannot be edited or deleted.</p>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm max-sm:w-full">
          <span className="block text-xs font-medium text-muted">Action</span>
          <select name="action" defaultValue={action ?? ""} className={field}>
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="text-sm max-sm:w-full">
          <span className="block text-xs font-medium text-muted">User (email contains)</span>
          <input name="user" type="search" defaultValue={user ?? ""} className={field} />
        </label>
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      <div className="overflow-x-auto md:card">
        <table className="w-full text-left text-sm max-md:block">
          <caption className="sr-only">Audit log entries, newest first</caption>
          <thead className="text-xs uppercase tracking-wide text-muted max-md:sr-only md:bg-subtle">
            <tr>
              <th scope="col" className="py-2.5 md:px-4">Time (UTC)</th>
              <th scope="col" className="py-2.5 md:px-4">Action</th>
              <th scope="col" className="py-2.5 md:px-4">Actor</th>
              <th scope="col" className="py-2.5 md:px-4">Target</th>
              <th scope="col" className="py-2.5 md:px-4">IP</th>
              <th scope="col" className="py-2.5 md:px-4">Details</th>
            </tr>
          </thead>
          <tbody className="max-md:block">
            {items.map((i) => (
              <tr key={i.id} className="border-t border-line align-top max-md:mb-3 max-md:block max-md:rounded-xl max-md:border max-md:bg-surface max-md:p-3 first:border-t-0">
                <td data-label="Time" className={`whitespace-nowrap py-2.5 md:px-4 text-muted ${cell}`}>{stamp(i.at)}</td>
                <td data-label="Action" className={`py-2.5 md:px-4 font-mono text-xs ${cell}`}>{i.action}</td>
                <td data-label="Actor" className={`py-2.5 md:px-4 max-md:break-all ${cell}`}>{i.actor ?? "-"}</td>
                <td data-label="Target" className={`py-2.5 md:px-4 max-md:break-all ${cell}`}>{i.target ?? "-"}</td>
                <td data-label="IP" className={`py-2.5 md:px-4 ${cell}`}>{i.ip ?? "-"}</td>
                <td data-label="Details" className={`py-2.5 md:px-4 font-mono text-xs text-muted max-md:break-all max-md:empty:hidden ${cell}`}>{i.detail ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length === 0 && <p className="mt-4 text-sm text-muted">No entries match.</p>}
      {next && (
        <p className="mt-4 text-sm">
          <Link href={`/admin/audit?${older.toString()}`} className="link">
            Older entries
          </Link>
        </p>
      )}
    </main>
  );
}
