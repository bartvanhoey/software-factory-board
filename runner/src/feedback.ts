export interface Feedback {
  /** Which lane sent the card back. */
  kind: "qa" | "review";
  /** The abbreviated commit the lane judged, from the comment's first line. */
  sha: string;
  /** The whole comment, for the rework prompt. */
  body: string;
}

export interface ReworkState {
  /** The latest verdict, if it sent the card back: a qa fail or a review "changes requested". Otherwise null. */
  feedback: Feedback | null;
  /** True when a `[build]` comment came after that feedback, such as a failed rework attempt. */
  buildAfterFeedback: boolean;
  /** How many reworks already finished (`[build] rework done` comments). */
  rounds: number;
}

const FEEDBACK = [
  { kind: "qa", pattern: /^\[qa\] fail at ([0-9a-f]{7,40})\b/ },
  { kind: "review", pattern: /^\[review\] changes requested at ([0-9a-f]{7,40})\b/ },
] as const;

const OTHER_VERDICT = /^\[(qa|review)\] (pass|approved|merged|back to qa|inconclusive)\b/;

/**
 * What the issue's comments say about reworking a card. Only comments written by `login`, the factory's
 * own account, count, so nobody else can steer the builder. Comments are read oldest first by their first
 * line: a later verdict replaces an earlier one, so feedback is only live while it is the latest verdict.
 */
export function reworkState(comments: readonly { author: string; body: string }[], login: string): ReworkState {
  let feedback: Feedback | null = null;
  let buildAfterFeedback = false;
  let rounds = 0;
  for (const comment of comments) {
    if (comment.author.toLowerCase() !== login.toLowerCase()) continue;
    const first = comment.body.replace(/\r/g, "").split("\n")[0] ?? "";
    const hit = FEEDBACK.map((f) => ({ kind: f.kind, m: f.pattern.exec(first) })).find((h) => h.m !== null);
    if (hit?.m) {
      feedback = { kind: hit.kind, sha: hit.m[1] as string, body: comment.body };
      buildAfterFeedback = false;
    } else if (OTHER_VERDICT.test(first)) {
      feedback = null;
      buildAfterFeedback = false;
    } else if (first.startsWith("[build]")) {
      buildAfterFeedback = true;
      if (first.startsWith("[build] rework done")) rounds++;
    }
  }
  return { feedback, buildAfterFeedback, rounds };
}

/** The first reason bullet of a feedback comment, cut to 120 characters, for the hand-off comment. */
export function firstReason(feedback: Feedback): string {
  const line = feedback.body
    .replace(/\r/g, "")
    .split("\n")
    .find((l) => l.startsWith("- "));
  const text = (line ?? "").slice(2).trim();
  if (text === "") return `see the [${feedback.kind}] comment`;
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

/** A code fence longer than any run of tildes in `text`, so quoted feedback cannot close it early. */
export function fenceFor(text: string): string {
  let fence = "~~~";
  while (text.includes(fence)) fence += "~";
  return fence;
}
