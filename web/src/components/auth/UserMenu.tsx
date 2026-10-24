import Link from "next/link";
import { logoutAction } from "@/auth/actions";
import { getSession } from "@/auth/dal";

/** Who is logged in, with the password and logout actions. Renders nothing for visitors. */
export async function UserMenu() {
  const session = await getSession();
  if (!session) return null;
  return (
    <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
      <span>{session.email}</span>
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
