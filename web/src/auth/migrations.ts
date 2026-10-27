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
  {
    version: 2,
    name: "throttle, expiry indexes",
    sql: `
      -- Login backoff counters and registration windows. Key prefix says which: "login:..." counts
      -- failures (updated_at = last failure), "register:..." is a fixed window (updated_at = window start).
      CREATE TABLE throttle (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX throttle_updated_at ON throttle (updated_at);
      CREATE INDEX sessions_expires_at ON sessions (expires_at);
    `,
  },
  {
    version: 3,
    name: "audit action index",
    sql: `
      -- The audit screen lists the distinct actions on every load; the log only ever grows.
      CREATE INDEX audit_log_action ON audit_log (action);
    `,
  },
  {
    version: 4,
    name: "mfa",
    sql: `
      -- mfa_secret_enc is AES-GCM (see mfa-crypto.ts). mfa_last_step is the newest TOTP step already accepted,
      -- so a code cannot be used twice.
      ALTER TABLE users ADD COLUMN mfa_secret_enc TEXT;
      ALTER TABLE users ADD COLUMN mfa_enabled_at INTEGER;
      ALTER TABLE users ADD COLUMN mfa_last_step INTEGER NOT NULL DEFAULT 0;

      -- A secret waiting for its first correct code. The live secret is never replaced before that, so a
      -- failed re-enrolment cannot lock anyone out. session_hash ties it to the session that asked for it: another
      -- session of the same user can neither read it nor confirm it.
      CREATE TABLE mfa_setup (
        user_id TEXT PRIMARY KEY REFERENCES users (id),
        secret_enc TEXT NOT NULL,
        session_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE recovery_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users (id),
        code_hash TEXT NOT NULL UNIQUE,
        used_at INTEGER
      ) STRICT;
      CREATE INDEX recovery_codes_user_id ON recovery_codes (user_id);
    `,
  },
  {
    version: 5,
    name: "email tokens",
    sql: `
      -- Links sent by email (verify an address, reset a password). Only a hash of the token is stored, and it also
      -- covers the purpose, so a token for one cannot be used for the other. used_at makes a link single-use.
      CREATE TABLE email_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users (id),
        purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      ) STRICT;
      CREATE INDEX email_tokens_user ON email_tokens (user_id, purpose);

      -- A reset link must not outlive a password change, whoever or whatever made it (the user, an admin, the break-glass
      -- command, the web app's own reset): otherwise evicting an intruder by changing the password leaves their link
      -- working. A trigger covers every writer, present and future. Disabling an account ends all its unused links.
      CREATE TRIGGER email_tokens_void_on_password_change AFTER UPDATE OF password_hash ON users
        WHEN NEW.password_hash <> OLD.password_hash
        BEGIN DELETE FROM email_tokens WHERE user_id = NEW.id AND purpose = 'reset' AND used_at IS NULL; END;
      CREATE TRIGGER email_tokens_void_on_disable AFTER UPDATE OF disabled_at ON users
        WHEN NEW.disabled_at IS NOT NULL AND OLD.disabled_at IS NULL
        BEGIN DELETE FROM email_tokens WHERE user_id = NEW.id AND used_at IS NULL; END;
    `,
  },
];
