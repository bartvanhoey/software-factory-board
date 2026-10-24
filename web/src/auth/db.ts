// No "server-only" or next/* imports: vitest and the break-glass CLI load this outside Next.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync as Database } from "node:sqlite";
import { loadAuthConfig } from "./config";
import { migrations as shipped, type Migration } from "./migrations";

// node:sqlite is a prefix-only builtin: vite and webpack strip "node:" and then cannot find "sqlite".
// getBuiltinModule bypasses the bundlers.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
type DatabaseSync = Database;

/** Opens the database, sets the pragmas and applies pending migrations. */
export function openDb(path: string, list: readonly Migration[] = shipped): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
  `);
  try {
    migrate(db, list);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

export function migrate(db: DatabaseSync, list: readonly Migration[]): void {
  list.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migration ${m.name}: expected version ${i + 1}, got ${m.version}`);
  });

  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT");

  // IMMEDIATE takes the write lock up front, so a second process (the CLI) waits and then finds nothing to do.
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as { v: number };
    if (row.v > list.length) {
      throw new Error(`auth.db is at schema version ${row.v} but this build only knows ${list.length}; refusing to start`);
    }
    const record = db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
    for (const m of list.slice(row.v)) {
      db.exec(m.sql);
      record.run(m.version, Date.now());
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Next bundles instrumentation and route handlers separately, so a module-level variable would open the file twice.
const cache = globalThis as { __authDb?: DatabaseSync };

/** The shared connection, opened and migrated on first use. */
export function getDb(): DatabaseSync {
  cache.__authDb ??= openDb(loadAuthConfig().dbPath);
  return cache.__authDb;
}
