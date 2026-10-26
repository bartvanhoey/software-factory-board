import { ConfigError, loadAuthConfig } from "./auth/config";
import { getDb } from "./auth/db";
import { seedAdmin } from "./auth/service";

/**
 * Validates the auth config, opens and migrates auth.db and seeds the first admin before serving.
 * A throw from register() is only logged and the server keeps answering 500, so exit instead:
 * the container stops and the problem is visible in `docker compose logs web`.
 */
export async function startAuth(): Promise<void> {
  try {
    const config = loadAuthConfig();
    // The flag is validated but nothing enforces it yet (planned for a later release). Starting anyway would
    // make an operator believe emails are verified.
    if (config.emailVerification) throw new Error("EMAIL_VERIFICATION=true is not supported yet; set it to false");
    const seeded = await seedAdmin(getDb(), config.admin);
    if (seeded === "seeded") console.log(`[auth] created the first admin ${config.admin?.email}; it must change its password at first login`);
    if (seeded === "email-taken") console.warn(`[auth] ADMIN_EMAIL is already registered as a normal account and no admin exists; nothing was changed`);
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : `auth.db failed to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
