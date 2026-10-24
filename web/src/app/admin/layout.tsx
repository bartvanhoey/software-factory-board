import Link from "next/link";
import type { ReactNode } from "react";
import { UserMenu } from "@/components/auth/UserMenu";

// Navigation only. Layouts do not re-render on navigation, so every admin page checks access itself;
// UserMenu just shows who is logged in (nothing for a visitor) and offers logout.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/" className="text-zinc-600 hover:underline dark:text-zinc-400">
            ← board
          </Link>
          <Link href="/admin/users" className="font-medium hover:underline">
            Users
          </Link>
          <Link href="/admin/audit" className="font-medium hover:underline">
            Audit log
          </Link>
        </p>
        <UserMenu />
      </div>
      {children}
    </div>
  );
}
