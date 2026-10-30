import Link from "next/link";
import { logoutAction } from "@/auth/actions";
import { getSession } from "@/auth/dal";
import { getDb } from "@/auth/db";
import { countPending, hasRole } from "@/auth/users";

/** Who is logged in, with the password and logout actions. Renders nothing for visitors. */
export async function UserMenu() {
  const session = await getSession();
  if (!session || session.mfaPending) return null;
  const isAdmin = hasRole(session.roles, "admin");
  const isManager = !isAdmin && hasRole(session.roles, "issue-admin");
  const pending = isAdmin ? countPending(getDb()) : 0;
  return (
    <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
      <span>{session.email}</span>
      {isAdmin && (
        <Link href="/admin/users" className="hover:underline">
          Admin{pending > 0 ? ` (${pending} pending)` : ""}
        </Link>
      )}
      {isManager && (
        <Link href="/admin/projects" className="hover:underline">
          Projects
        </Link>
      )}
      <Link href="/account/mfa" className="hover:underline">
        MFA
      </Link>
      <Link href="/account/password" className="hover:underline">
        Password
      </Link>
      <form action={logoutAction}>
        <button type="submit" className="hover:underline">
          Log out
        </button>
      </form>
    </div>
  );
}
