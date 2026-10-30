import { z } from "zod";

const slug = z.string().max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be a lowercase slug, e.g. my-project");
/**
 * owner/name as GitHub allows it, and a little narrower: the name becomes a folder in the runner's workspace and is passed
 * to `gh repo clone` as an argument, so it must not start with - or ., be "." or "..", or end in .git (which would make
 * "o/n.git" and "o/n" two projects for one repository).
 */
const repo = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9._-]*$/, "must be owner/name")
  .refine((r) => !r.endsWith(".git"), "must not end in .git");
/** Relative to the runner's repo root: a path that could leave it would read any file into a prompt. */
const promptPath = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/, "must be a relative path")
  .refine((p) => !p.includes("..") && !p.includes("//"), "must stay inside the repo");
/** One line: these run in the runner container, and the web app lets people type them. */
const command = z.string().min(1).max(500).regex(/^[^\r\n]+$/, "must be a single line");
/** Passed to git as an argument and as part of a ref: no leading dash or dot, no "..", no "//", no trailing slash. */
const branch = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/, "may only contain letters, digits, . _ - and /, and must not start with - or .")
  .refine((b) => !b.includes("..") && !b.includes("//") && !b.endsWith("/") && !b.endsWith(".lock"), "is not a valid branch name");
/** Upper bounds, so a typo or a bad actor cannot set a run up to spend without limit. */
export const MAX_TURNS = 100;
export const MAX_REWORKS = 5;
const turns = z.number().int().positive().max(MAX_TURNS);

export const ProjectSchema = z
  .object({
    name: slug,
    repo,
    defaultBranch: branch.default("main"),
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
    limits: z
      .object({
        /** Agent turn cap for the build lane. */
        maxTurns: turns.default(20),
        /** Agent turn cap for the qa lane. */
        qaMaxTurns: turns.default(20),
        /** Agent turn cap for the review lane. */
        reviewMaxTurns: turns.default(20),
        /** How many times the build lane reworks a card by itself after qa or review sent it back. 0 turns it off. */
        maxReworks: z.number().int().min(0).max(MAX_REWORKS).default(2),
      })
      .strict()
      .default({}),
    prompts: z
      .object({
        builder: promptPath.optional(),
        qa: promptPath.optional(),
        review: promptPath.optional(),
        rework: promptPath.optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export type Project = z.infer<typeof ProjectSchema>;

/** What the web service answers on its internal projects endpoint, and what the runner expects. */
export const ProjectsResponseSchema = z.object({ projects: z.array(ProjectSchema) }).strict();
export type ProjectsResponse = z.infer<typeof ProjectsResponseSchema>;
export type ProjectInput = z.input<typeof ProjectSchema>;

/** A project without a test command has no safety net; lanes use this to adapt. */
export const hasTests = (p: Project): boolean => p.commands.test !== undefined;
