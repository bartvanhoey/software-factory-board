import { z } from "zod";

export const EVENT_LANES = ["build", "qa", "review", "system"] as const;

export const EVENT_TYPES = [
  "started",
  "noop",
  "claimed",
  "agent_done",
  "verified",
  "pr_opened",
  "handed_off",
  "labels_created",
  "failed",
] as const;

/** One line of $FACTORY_DATA/events.jsonl, written by the runner and read by the dashboard. */
export const EventSchema = z
  .object({
    ts: z.string().datetime(),
    project: z.string().min(1),
    lane: z.enum(EVENT_LANES),
    type: z.enum(EVENT_TYPES),
    issue: z.number().int().positive().optional(),
    message: z.string(),
    url: z.string().optional(),
  })
  .strict();

export type FactoryEvent = z.infer<typeof EventSchema>;
export type NewEvent = Omit<FactoryEvent, "ts">;
