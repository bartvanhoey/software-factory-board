export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Ordered schema changes for auth.db. Versions are 1..n with no gaps; never edit a
 * migration that has shipped, add a new one. Timestamps are integer epoch milliseconds.
 */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "users, roles, sessions, audit log",
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254),
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        disabled_at INTEGER,
        email_verified_at INTEGER,
        must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
        mfa_required INTEGER NOT NULL DEFAULT 0 CHECK (mfa_required IN (0, 1))
      ) STRICT;

      CREATE TABLE user_roles (
        user_id TEXT NOT NULL REFERENCES users (id),
        role TEXT NOT NULL CHECK (role IN ('admin', 'issue-admin', 'viewer')),
        granted_by TEXT REFERENCES users (id),
        granted_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, role)
      ) STRICT;

      -- id_hash is the SHA-256 of the cookie token, so a leaked database cannot be replayed.
      CREATE TABLE sessions (
        id_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id),
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        mfa_pending INTEGER NOT NULL DEFAULT 0 CHECK (mfa_pending IN (0, 1)),
        ip TEXT,
        user_agent TEXT
      ) STRICT;
      CREATE INDEX sessions_user_id ON sessions (user_id);

      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        actor_user_id TEXT REFERENCES users (id),
        action TEXT NOT NULL,
        target_user_id TEXT REFERENCES users (id),
        ip TEXT,
        detail TEXT
      ) STRICT;
      CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
        BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
      CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
        BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
    `,
  },
];
