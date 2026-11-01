import Link from "next/link";
import { logoutAction } from "@/auth/actions";
import { getSession } from "@/auth/dal";
import { Dropdown } from "@/components/Dropdown";

const item = "block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-subtle";

/** Who is logged in, with the account actions. Renders nothing for visitors. */
export async function UserMenu() {
  const session = await getSession();
  if (!session || session.mfaPending) return null;
  return (
    <Dropdown label="Account menu" trigger={<span aria-hidden="true">{session.email.charAt(0).toUpperCase()}</span>}>
      <p className="truncate border-b border-line px-3 pt-1.5 pb-2.5 text-xs text-muted" title={session.email}>
        Signed in as
        <span className="block truncate text-sm font-medium text-fg">{session.email}</span>
      </p>
      <div className="pt-1.5">
        <Link href="/account/mfa" className={item}>
          Two-factor authentication
        </Link>
        <Link href="/account/password" className={item}>
          Change password
        </Link>
        <form action={logoutAction}>
          <button type="submit" className={item}>
            Log out
          </button>
        </form>
      </div>
    </Dropdown>
  );
}
