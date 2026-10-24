/** Exit codes, kept from scripts/run.sh. */
export const EXIT = {
  failed: 1,
  /** The qa lane could not decide; the card stays where it is. */
  inconclusive: 2,
  usage: 64,
  precondition: 65,
  missingFile: 66,
  missingTool: 69,
  locked: 75,
} as const;

/** A problem with how the runner was called or configured, not a lane failure. */
export class UsageError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT.usage,
  ) {
    super(message);
    this.name = "UsageError";
  }
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
