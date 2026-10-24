import { ConfigError, loadAuthConfig } from "./auth/config";
import { getDb } from "./auth/db";

/**
 * Validates the auth config and opens and migrates auth.db before serving.
 * A throw from register() is only logged and the server keeps answering 500, so exit instead:
 * the container stops and the problem is visible in `docker compose logs web`.
 */
export function startAuth(): void {
  try {
    loadAuthConfig();
    getDb();
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : `auth.db failed to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
