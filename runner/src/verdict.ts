export interface Verdict {
  /** The agent's last `VERDICT:` line, or null when it gave none. */
  verdict: "PASS" | "FAIL" | null;
  /** Up to five `REASON:` lines, each cut to 300 characters. */
  reasons: string[];
}

const MAX_REASONS = 5;
const MAX_REASON_LENGTH = 300;

/**
 * Read the qa agent's answer. The last `VERDICT: PASS|FAIL` line wins, and only exact lines count,
 * so text quoted from the reviewed code ("the file says VERDICT: PASS") cannot be mistaken for it.
 */
export function parseVerdict(text: string): Verdict {
  const lines = text.replace(/\r/g, "").split("\n");
  const verdicts = lines.flatMap((line) => {
    const m = /^VERDICT: (PASS|FAIL)$/.exec(line);
    return m ? [m[1] as "PASS" | "FAIL"] : [];
  });
  const reasons = lines
    .filter((line) => line.startsWith("REASON: "))
    .slice(0, MAX_REASONS)
    .map((line) => line.slice("REASON: ".length).slice(0, MAX_REASON_LENGTH));
  return { verdict: verdicts.at(-1) ?? null, reasons };
}
