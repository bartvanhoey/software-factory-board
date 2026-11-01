import type { ReactNode } from "react";
import { getSession } from "@/auth/dal";
import { hasRole } from "@/auth/users";
import { NavLink } from "@/components/NavLink";

// Navigation only. Layouts do not re-render on navigation, so every admin page checks access itself.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Links only: a Project manager sees Projects, an Administrator sees all three.
  const session = await getSession();
  const isAdmin = !!session && hasRole(session.roles, "admin");
  return (
    <div className="max-w-6xl">
      <nav aria-label="Admin" className="mb-8 flex gap-6 overflow-x-auto border-b border-line">
        {isAdmin && (
          <NavLink variant="tab" href="/admin/users">
            Users
          </NavLink>
        )}
        <NavLink variant="tab" href="/admin/projects">
          Projects
        </NavLink>
        {isAdmin && (
          <NavLink variant="tab" href="/admin/audit">
            Audit log
          </NavLink>
        )}
      </nav>
      {children}
    </div>
  );
}
