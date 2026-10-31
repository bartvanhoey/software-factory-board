import Link from "next/link";
import type { ReactNode } from "react";
import { getSession } from "@/auth/dal";
import { hasRole } from "@/auth/users";
import { UserMenu } from "@/components/auth/UserMenu";

// Navigation only. Layouts do not re-render on navigation, so every admin page checks access itself;
// UserMenu just shows who is logged in (nothing for a visitor) and offers logout.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Links only: a Project manager sees Projects, an Administrator sees all three. Each page still checks access itself.
  const session = await getSession();
  const isAdmin = !!session && hasRole(session.roles, "admin");
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/" className="py-1.5 text-zinc-600 hover:underline dark:text-zinc-400">
            ← board
          </Link>
          {isAdmin && (
            <Link href="/admin/users" className="py-1.5 font-medium hover:underline">
              Users
            </Link>
          )}
          <Link href="/admin/projects" className="py-1.5 font-medium hover:underline">
            Projects
          </Link>
          {isAdmin && (
            <Link href="/admin/audit" className="py-1.5 font-medium hover:underline">
              Audit log
            </Link>
          )}
        </p>
        <UserMenu />
      </div>
      {children}
    </div>
  );
}
