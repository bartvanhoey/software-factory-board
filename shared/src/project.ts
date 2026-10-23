import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be a lowercase slug, e.g. my-project");
const command = z.string().min(1);

export const ProjectSchema = z
  .object({
    name: slug,
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "must be owner/name"),
    defaultBranch: z.string().min(1).default("main"),
    enabled: z.boolean().default(true),
    stack: z.enum(["dotnet", "node", "python", "other"]).default("other"),
    commands: z
      .object({ build: command.optional(), test: command.optional() })
      .strict()
      .default({}),
    lanes: z
      .object({
        build: z.boolean().default(true),
        qa: z.boolean().default(true),
        review: z.boolean().default(true),
      })
      .strict()
      .default({}),
    limits: z.object({ maxTurns: z.number().int().positive().default(20) }).strict().default({}),
    prompts: z
      .object({
        builder: z.string().min(1).optional(),
        qa: z.string().min(1).optional(),
        review: z.string().min(1).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectInput = z.input<typeof ProjectSchema>;

/** A project without a test command has no safety net; lanes use this to adapt. */
export const hasTests = (p: Project): boolean => p.commands.test !== undefined;
