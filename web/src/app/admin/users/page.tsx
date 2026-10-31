import { listUsers } from "@/auth/admin";
import { getAuthConfig } from "@/auth/config";
import { requireAccess } from "@/auth/dal";
import { getDb } from "@/auth/db";
import { UserControls } from "@/components/admin/UserControls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users · Software Factory Board" };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const statusStyle = {
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  active: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
  disabled: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
};

/** On a phone each row is a card and each cell shows its column name (from data-label) in front of its value. */
const cell = "max-md:flex max-md:gap-3 max-md:py-1 max-md:pr-0 max-md:before:w-20 max-md:before:shrink-0 max-md:before:text-xs max-md:before:uppercase max-md:before:text-zinc-500 max-md:before:content-[attr(data-label)]";

export default async function UsersPage() {
  const admin = await requireAccess("admin");
  const { users, pending } = listUsers(getDb(), admin.userId);
  const emailVerification = getAuthConfig().emailVerification;

  return (
    <main>
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Users</h1>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        {pending > 0 ? `${pending} account${pending === 1 ? "" : "s"} waiting for a role. ` : "No accounts are waiting for a role. "}
        Admin includes issue-admin and viewer; issue-admin includes viewer.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm max-md:block">
          <caption className="sr-only">All accounts, accounts waiting for a role first</caption>
          <thead className="text-xs uppercase text-zinc-500 max-md:sr-only dark:text-zinc-400">
            <tr>
              <th scope="col" className="py-2 pr-4">Account</th>
              <th scope="col" className="py-2 pr-4">Status</th>
              <th scope="col" className="py-2 pr-4">MFA</th>
              {emailVerification && <th scope="col" className="py-2 pr-4">Email</th>}
              <th scope="col" className="py-2 pr-4">Created</th>
              <th scope="col" className="py-2">Roles and actions</th>
            </tr>
          </thead>
          <tbody className="max-md:block">
            {users.map((u) => (
              <tr key={u.id} className="border-t border-zinc-200 align-top max-md:mb-3 max-md:block max-md:rounded-lg max-md:border max-md:p-3 dark:border-zinc-800">
                <th scope="row" className="py-3 pr-4 font-medium max-md:block max-md:break-all max-md:py-1 max-md:pr-0">{u.email}</th>
                <td data-label="Status" className={`py-3 pr-4 ${cell}`}>
                  <span className={`rounded px-2 py-0.5 text-xs ${statusStyle[u.status]}`}>{u.status}</span>
                </td>
                <td data-label="MFA" className={`py-3 pr-4 text-zinc-600 dark:text-zinc-400 ${cell}`}>
                  <span>
                    {u.mfaEnabled ? "on" : "off"}
                    {u.mfaRequired ? " · required" : ""}
                  </span>
                </td>
                {emailVerification && <td data-label="Email" className={`py-3 pr-4 text-zinc-600 dark:text-zinc-400 ${cell}`}>{u.emailVerified ? "confirmed" : "not confirmed"}</td>}
                <td data-label="Created" className={`py-3 pr-4 text-zinc-600 dark:text-zinc-400 ${cell}`}>{day(u.createdAt)}</td>
                <td className="py-3 max-md:block max-md:pb-0 max-md:pt-2">
                  <UserControls
                    id={u.id}
                    email={u.email}
                    roles={u.roles}
                    disabled={u.status === "disabled"}
                    isSelf={u.id === admin.userId}
                    mfaEnabled={u.mfaEnabled}
                    mfaRequired={u.mfaRequired}
                    emailVerified={u.emailVerified}
                    emailVerification={emailVerification}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
