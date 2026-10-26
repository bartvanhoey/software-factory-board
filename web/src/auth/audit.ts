import type { DatabaseSync } from "node:sqlite";

export interface AuditEvent {
  action: string;
  actor?: string | null;
  target?: string | null;
  ip?: string | null;
  detail?: Record<string, unknown>;
}

/** Appends to the audit log. The table is append-only; there is no way to edit or delete an entry. */
export function audit(db: DatabaseSync, e: AuditEvent, now = Date.now()): void {
  db.prepare("INSERT INTO audit_log (at, actor_user_id, action, target_user_id, ip, detail) VALUES (?, ?, ?, ?, ?, ?)").run(
    now,
    e.actor ?? null,
    e.action,
    e.target ?? null,
    e.ip ?? null,
    e.detail ? JSON.stringify(e.detail) : null,
  );
}
