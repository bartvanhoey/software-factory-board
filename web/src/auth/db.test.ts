import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDb } from "./db";
import { migrations } from "./migrations";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "auth-db-"));
  dirs.push(dir);
  return join(dir, "nested", "auth.db");
}

function addUser(db: ReturnType<typeof openDb>, email: string, id = email): void {
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'x', 0)").run(id, email);
}

describe("openDb migrations", () => {
  it("applies the migrations to an empty database", () => {
    const db = openDb(":memory:");
    const v = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
    expect(v.v).toBe(migrations.length);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(["users", "user_roles", "sessions", "audit_log", "schema_migrations"]));
  });

  it("is a no-op the second time", () => {
    const db = openDb(":memory:");
    migrate(db, migrations);
    const rows = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
    expect(rows.n).toBe(migrations.length);
  });

  it("creates missing folders, uses WAL and keeps data across reopen", () => {
    const path = tempDbPath();
    const db = openDb(path);
    expect((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    addUser(db, "a@example.com");
    db.close();
    const again = openDb(path);
    expect(again.prepare("SELECT email FROM users").all()).toEqual([{ email: "a@example.com" }]);
    again.close();
  });

  it("refuses a database that is newer than the code", () => {
    const path = tempDbPath();
    openDb(path).close();
    expect(() => openDb(path, [])).toThrow(/refusing to start/);
  });

  it("rolls back a failing migration completely", () => {
    const db = openDb(":memory:", []);
    const bad = [{ version: 1, name: "bad", sql: "CREATE TABLE t (a INTEGER); INSERT INTO nope VALUES (1);" }];
    expect(() => migrate(db, bad)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 't'").all()).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: 0 });
  });

  it("rejects a migration list with a gap", () => {
    const db = openDb(":memory:", []);
    expect(() => migrate(db, [{ version: 2, name: "gap", sql: "SELECT 1" }])).toThrow(/expected version 1/);
  });
});

describe("schema constraints", () => {
  it("rejects an email that is not lowercase", () => {
    expect(() => addUser(openDb(":memory:"), "Upper@Example.com")).toThrow();
  });

  it("rejects a duplicate email", () => {
    const db = openDb(":memory:");
    addUser(db, "a@example.com", "1");
    expect(() => addUser(db, "a@example.com", "2")).toThrow();
  });

  it("accepts the three roles and rejects any other", () => {
    const db = openDb(":memory:");
    addUser(db, "a@example.com");
    const grant = db.prepare("INSERT INTO user_roles (user_id, role, granted_at) VALUES ('a@example.com', ?, 0)");
    for (const role of ["admin", "issue-admin", "viewer"]) grant.run(role);
    expect(() => grant.run("root")).toThrow();
  });

  it("enforces foreign keys", () => {
    const db = openDb(":memory:");
    expect(() => db.exec("INSERT INTO user_roles (user_id, role, granted_at) VALUES ('ghost', 'viewer', 0)")).toThrow();
  });

  it("makes the audit log append-only", () => {
    const db = openDb(":memory:");
    db.exec("INSERT INTO audit_log (at, action) VALUES (0, 'login')");
    expect(() => db.exec("UPDATE audit_log SET action = 'x'")).toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM audit_log")).toThrow(/append-only/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log").get()).toEqual({ n: 1 });
  });
});
