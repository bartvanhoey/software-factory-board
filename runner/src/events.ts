import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { EventSchema, type NewEvent } from "@factory/shared";
import type { EventLog } from "./ports.js";

/**
 * Appends one JSON line per event to events.jsonl. A problem writing the log is reported on
 * stderr and never stops the lane: the log is for watching, not for control flow.
 */
export function createEventLog(file: string, now: () => Date = () => new Date()): EventLog {
  return {
    append(event: NewEvent) {
      try {
        const line = EventSchema.parse({ ts: now().toISOString(), ...event });
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, `${JSON.stringify(line)}\n`);
      } catch (e) {
        console.error(`warning: could not write event: ${(e as Error).message}`);
      }
    },
  };
}
