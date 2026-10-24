export interface Verdict<W extends string = "PASS" | "FAIL"> {
  /** The agent's last `VERDICT:` line, or null when it gave none. */
  verdict: W | null;
  /** Up to five `REASON:` lines, each cut to 300 characters. */
  reasons: string[];
}

const MAX_REASONS = 5;
const MAX_REASON_LENGTH = 300;

/**
 * Read an agent's answer. The last `VERDICT: <word>` line wins, where <word> is one of `words`
 * (default PASS or FAIL). Only exact lines count, so text quoted from the reviewed code
 * ("the file says VERDICT: PASS") cannot be mistaken for the verdict.
 */
export function parseVerdict(text: string): Verdict;
export function parseVerdict<W extends string>(text: string, words: readonly W[]): Verdict<W>;
export function parseVerdict(text: string, words: readonly string[] = ["PASS", "FAIL"]): Verdict<string> {
  const lines = text.replace(/\r/g, "").split("\n");
  const verdicts = lines.flatMap((line) => {
    const m = /^VERDICT: (\S+)$/.exec(line);
    return m && words.includes(m[1] as string) ? [m[1] as string] : [];
  });
  const reasons = lines
    .filter((line) => line.startsWith("REASON: "))
    .slice(0, MAX_REASONS)
    .map((line) => line.slice("REASON: ".length).slice(0, MAX_REASON_LENGTH));
  return { verdict: verdicts.at(-1) ?? null, reasons };
}
