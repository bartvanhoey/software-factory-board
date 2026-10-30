import { join, dirname } from "node:path";
import { ConfigError, loadAuthConfig, loadRunnerToken } from "./auth/config";
import { getDb } from "./auth/db";
import { importProjects } from "./auth/projects";
import { seedAdmin } from "./auth/service";

/**
 * Validates the auth config, opens and migrates auth.db and seeds the first admin before serving.
 * A throw from register() is only logged and the server keeps answering 500, so exit instead:
 * the container stops and the problem is visible in `docker compose logs web`.
 */
export async function startAuth(): Promise<void> {
  try {
    const config = loadAuthConfig();
    loadRunnerToken(); // the runner cannot fetch its projects without it, so the web service does not start without it
    // SMTP is deliberately not probed here: a mail server that is down must never stop the dashboard from starting,
    // and logins never need it. Only registration, resend and password reset do.
    if (config.emailVerification) console.log(`[auth] email verification is on; mail goes through ${config.smtp?.host}:${config.smtp?.port}, links point at ${config.appUrl}`);
    const db = getDb();
    // A one-time move of projects/*.json into the table. It does nothing once the table has a row.
    importProjects(db, process.env.FACTORY_PROJECTS_DIR?.trim() || join(dirname(process.cwd()), "projects"));
    const seeded = await seedAdmin(db, config.admin);
    if (seeded === "seeded") console.log(`[auth] created the first admin ${config.admin?.email}; it must change its password at first login`);
    if (seeded === "email-taken") console.warn(`[auth] ADMIN_EMAIL is already registered as a normal account and no admin exists; nothing was changed`);
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : `auth.db failed to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
