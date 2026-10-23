import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasTests, loadProjects } from "../src/index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "projects");
try {
  const projects = loadProjects(dir);
  for (const p of projects) {
    console.log(`ok  ${p.name}  ${p.repo}${hasTests(p) ? "" : "  (no tests)"}${p.enabled ? "" : "  (disabled)"}`);
  }
  console.log(`${projects.length} project(s) valid`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
