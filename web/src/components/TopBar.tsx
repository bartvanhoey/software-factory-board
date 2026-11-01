import Link from "next/link";
import { getSession } from "@/auth/dal";
import { getDb } from "@/auth/db";
import { countPending, hasRole } from "@/auth/users";
import { NavLink } from "./NavLink";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./auth/UserMenu";

function Logo() {
  return (
    <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
      <svg viewBox="0 0 16 16" className="size-4" fill="currentColor">
        <rect x="1.5" y="2" width="3.5" height="12" rx="1" />
        <rect x="6.25" y="2" width="3.5" height="8" rx="1" />
        <rect x="11" y="2" width="3.5" height="5" rx="1" />
      </svg>
    </span>
  );
}

/** The one header every page shares: brand, main navigation, theme and account. */
export async function TopBar() {
  const session = await getSession();
  const signedIn = !!session && !session.mfaPending;
  const isAdmin = signedIn && hasRole(session.roles, "admin");
  const isManager = signedIn && !isAdmin && hasRole(session.roles, "issue-admin");
  const pending = isAdmin ? countPending(getDb()) : 0;

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight">
          <Logo />
          <span className="max-sm:sr-only">Software Factory Board</span>
        </Link>

        {signedIn && (
          <nav aria-label="Main" className="flex items-center gap-1">
            <NavLink href="/" prefixes={["/projects/"]}>
              Board
            </NavLink>
            {isAdmin && (
              <NavLink href="/admin/users" prefixes={["/admin"]}>
                Admin
                {/* On the narrowest phones only the number shows, so the theme and account buttons stay on screen. */}
                {pending > 0 && (
                  <span className="badge badge-warn ml-1.5">
                    {pending}
                    <span className="max-[420px]:sr-only"> pending</span>
                  </span>
                )}
              </NavLink>
            )}
            {isManager && <NavLink href="/admin/projects">Projects</NavLink>}
          </nav>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
