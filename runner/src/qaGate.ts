export interface QaGateResult {
  pass: boolean;
  /** The abbreviated commit the qa lane wrote in its comment. */
  sha: string;
}

/**
 * The qa lane's latest result for an issue, read from its comments (`[qa] pass at <sha>` or
 * `[qa] fail at <sha>`). Only comments written by `login`, the factory's own account, count:
 * anyone who can comment on an issue could otherwise forge a pass. The latest result wins, so a
 * later fail cancels an earlier pass. Returns null when the factory has not judged the issue.
 */
export function latestQaResult(comments: readonly { author: string; body: string }[], login: string): QaGateResult | null {
  let latest: QaGateResult | null = null;
  for (const comment of comments) {
    if (comment.author.toLowerCase() !== login.toLowerCase()) continue;
    for (const line of comment.body.replace(/\r/g, "").split("\n")) {
      const m = /^\[qa\] (pass|fail) at ([0-9a-f]{7,40})\b/.exec(line);
      if (m) latest = { pass: m[1] === "pass", sha: m[2] as string };
    }
  }
  return latest;
}
