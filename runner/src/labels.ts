import type { EventLog, Gh, LabelEnsurer, LabelSpec } from "./ports.js";

/** The four lane labels. Colours: grey, blue, yellow, green. */
export const LANE_LABEL_SPECS: readonly LabelSpec[] = [
  { name: "ready", color: "8b949e", description: "Factory: waiting for a builder" },
  { name: "building", color: "1f6feb", description: "Factory: an agent is working on it" },
  { name: "qa", color: "d4a72c", description: "Factory: built, being tested" },
  { name: "review", color: "2da44e", description: "Factory: waiting for a human" },
];

/** Specs not yet in the repo. GitHub label names are case-insensitive, so `Ready` counts as `ready`. */
export function missingLabels(existing: readonly string[], specs: readonly LabelSpec[] = LANE_LABEL_SPECS): LabelSpec[] {
  const have = new Set(existing.map((n) => n.toLowerCase()));
  return specs.filter((s) => !have.has(s.name.toLowerCase()));
}

/**
 * Create the missing lane labels. Only ever creates: existing labels keep their colour and
 * description. A label that appears between the list and the create (another runner, or a
 * human) counts as success.
 */
export async function ensureLabels(gh: Gh, repo: string): Promise<string[]> {
  const missing = missingLabels(await gh.listLabels(repo));
  const created: string[] = [];
  for (const spec of missing) {
    if ((await gh.createLabel(repo, spec)) === "created") created.push(spec.name);
  }
  return created;
}

/** Checks each repo once per process; `forget` makes the next call check again. */
export function createLabelEnsurer(gh: Gh, events: EventLog, project: string): LabelEnsurer {
  const checked = new Set<string>();
  return {
    async ensure(repo) {
      if (checked.has(repo)) return;
      const created = await ensureLabels(gh, repo);
      checked.add(repo);
      if (created.length > 0) {
        events.append({ project, lane: "system", type: "labels_created", message: `created labels: ${created.join(", ")}` });
      }
    },
    forget(repo) {
      checked.delete(repo);
    },
  };
}
