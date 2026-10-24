import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const ROLES = ["admin", "issue-admin", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: number;
  disabled_at: number | null;
  email_verified_at: number | null;
  must_change_password: number;
  mfa_required: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed and lowercased, or null when it is not an email address. The email is the identity. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/** Admin implies every other role. */
export function hasRole(roles: readonly Role[], needed: Role): boolean {
  return roles.includes("admin") || roles.includes(needed);
}

export function findUserByEmail(db: DatabaseSync, email: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
}

export function findUserById(db: DatabaseSync, id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function rolesOf(db: DatabaseSync, userId: string): Role[] {
  const rows = db.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(userId) as { role: Role }[];
  return rows.map((r) => r.role);
}

export function countAdmins(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM user_roles WHERE role = 'admin'").get() as { n: number };
  return row.n;
}

/** Accounts waiting for an admin to give them a role. */
export function countPending(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM users u WHERE u.disabled_at IS NULL AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id)")
    .get() as { n: number };
  return row.n;
}

export function createUser(
  db: DatabaseSync,
  u: { email: string; passwordHash: string; mustChangePassword?: boolean; verified?: boolean },
  now = Date.now(),
): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, created_at, email_verified_at, must_change_password) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, u.email, u.passwordHash, now, u.verified ? now : null, u.mustChangePassword ? 1 : 0);
  return id;
}

export function grantRole(db: DatabaseSync, userId: string, role: Role, grantedBy: string | null, now = Date.now()): void {
  db.prepare("INSERT INTO user_roles (user_id, role, granted_by, granted_at) VALUES (?, ?, ?, ?)").run(userId, role, grantedBy, now);
}
