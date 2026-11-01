import { z } from "zod";

/** Per-machine config (local.json, gitignored). Clone paths live here, never in a project's settings. */
export const LocalConfigSchema = z
  .object({
    workspace: z.string().min(1),
    overrides: z.record(z.string().min(1)).default({}),
  })
  .strict();

export type LocalConfig = z.infer<typeof LocalConfigSchema>;
