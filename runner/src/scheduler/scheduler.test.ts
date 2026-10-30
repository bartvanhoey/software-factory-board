import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProject, type NewEvent, type Project } from "@factory/shared";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../config.js";
import { Backoff, classify, type Lane } from "./backoff.js";
import { runPass, type RunResult } from "./pass.js";
import { childLaneRunner, runScheduler } from "./run.js";
import { loadSchedulerSettings } from "./settings.js";

const project = (name: string, extra: Record<string, unknown> = {}): Project => parseProject({ name, repo: `Owner/${name}`, ...extra }, `projects/${name}.json`);
const MIN = 60_000;
const ok: RunResult = { code: 0, timedOut: false };

describe("loadSchedulerSettings", () => {
  it("is off with the documented defaults", () => {
    expect(loadSchedulerSettings({})).toEqual({ enabled: false, intervalMs: 5 * MIN, runTimeoutMs: 120 * MIN });
    expect(loadSchedulerSettings({ SCHEDULER_ENABLED: "" }).enabled).toBe(false);
  });

  it("reads the three settings", () => {
    expect(loadSchedulerSettings({ SCHEDULER_ENABLED: "true", SCHEDULER_INTERVAL_MINUTES: "10", SCHEDULER_RUN_TIMEOUT_MINUTES: "30" })).toEqual({
      enabled: true,
      intervalMs: 10 * MIN,
      runTimeoutMs: 30 * MIN,
    });
  });

  it("refuses values it cannot read, naming the variable", () => {
    expect(() => loadSchedulerSettings({ SCHEDULER_ENABLED: "yes" })).toThrow(/SCHEDULER_ENABLED/);
    expect(loadSchedulerSettings({ SCHEDULER_ENABLED: " True " }).enabled).toBe(true);
    expect(() => loadSchedulerSettings({ SCHEDULER_INTERVAL_MINUTES: "0" })).toThrow(/SCHEDULER_INTERVAL_MINUTES/);
    expect(() => loadSchedulerSettings({ SCHEDULER_INTERVAL_MINUTES: "5m" })).toThrow(/SCHEDULER_INTERVAL_MINUTES/);
    expect(() => loadSchedulerSettings({ SCHEDULER_RUN_TIMEOUT_MINUTES: "180" })).toThrow(/SCHEDULER_RUN_TIMEOUT_MINUTES/);
  });
});

describe("classify", () => {
  it("treats a clean exit as progress", () => {
    for (const lane of ["review", "qa", "build"] as Lane[]) expect(classify(lane, 0)).toBe("progress");
  });

  it("counts exit 1 as a failure for build only", () => {
    expect(classify("build", 1)).toBe("no-progress");
    expect(classify("qa", 1)).toBe("progress");
    expect(classify("review", 1)).toBe("progress");
  });

  it("maps the other codes", () => {
    expect(classify("qa", 2)).toBe("no-progress");
    expect(classify("review", 2)).toBe("no-progress");
    expect(classify("build", 75)).toBe("skip");
    expect(classify("qa", 69)).toBe("pause-project");
    // 65 is raised for one card (no branch, wrong label), so it must not pause the project's other lanes
    expect(classify("qa", 65)).toBe("no-progress");
    expect(classify("review", 65)).toBe("no-progress");
    // an unexpected exception is not a card sent back
    expect(classify("qa", 70)).toBe("no-progress");
    expect(classify("review", 70)).toBe("no-progress");
    expect(classify("qa", null)).toBe("no-progress");
    expect(classify("build", 137)).toBe("no-progress");
  });
});

describe("Backoff", () => {
  const fp = "v1";
  const fail = (b: Backoff) => b.record("a", "qa", "no-progress", fp, "exit 2");

  it("waits 5, 10 and 20 minutes, pauses at the third failure, then probes hourly", () => {
    let now = 0;
    const b = new Backoff(() => now);
    expect(b.due("a", "qa", fp)).toBe(true);

    expect(fail(b)).toBeUndefined();
    now = 4 * MIN;
    expect(b.due("a", "qa", fp)).toBe(false);
    now = 5 * MIN;
    expect(b.due("a", "qa", fp)).toBe(true);

    expect(fail(b)).toBeUndefined();
    now += 9 * MIN;
    expect(b.due("a", "qa", fp)).toBe(false);
    now += MIN;
    expect(b.due("a", "qa", fp)).toBe(true);

    expect(fail(b)?.type).toBe("paused");
    now += 19 * MIN;
    expect(b.due("a", "qa", fp)).toBe(false);
    now += MIN;
    expect(b.due("a", "qa", fp)).toBe(true);

    expect(fail(b)).toBeUndefined(); // already paused: no second event
    now += 59 * MIN;
    expect(b.due("a", "qa", fp)).toBe(false);
    now += MIN;
    expect(b.due("a", "qa", fp)).toBe(true);
  });

  it("keeps lanes and projects apart, and resumes a paused lane on progress", () => {
    const b = new Backoff(() => 0);
    fail(b);
    fail(b);
    fail(b);
    expect(b.due("a", "build", fp)).toBe(true);
    expect(b.due("b", "qa", fp)).toBe(true);
    expect(b.record("a", "qa", "progress", fp, "exit 0")?.type).toBe("resumed");
    expect(b.due("a", "qa", fp)).toBe(true);
  });

  it("a short streak that ends in progress produces no events", () => {
    const b = new Backoff(() => 0);
    fail(b);
    expect(b.record("a", "qa", "progress", fp, "exit 0")).toBeUndefined();
  });

  it("does nothing for a skip", () => {
    const b = new Backoff(() => 0);
    expect(b.record("a", "qa", "skip", fp, "exit 75")).toBeUndefined();
    expect(b.due("a", "qa", fp)).toBe(true);
  });

  it("pauses a whole project until its registry entry changes", () => {
    const b = new Backoff(() => 0);
    expect(b.record("a", "build", "pause-project", "v1", "exit 69")?.type).toBe("paused");
    expect(b.due("a", "review", "v1")).toBe(false);
    expect(b.due("b", "review", "v1")).toBe(true);
    expect(b.refreshProject("a", "v1")).toBeUndefined();
    expect(b.refreshProject("a", "v2")?.type).toBe("resumed");
    expect(b.due("a", "review", "v2")).toBe(true);
  });
});

function harness(projects: Project[], codes: (lane: Lane, project: string, n: number) => RunResult | number = () => 0) {
  const calls: string[] = [];
  const events: NewEvent[] = [];
  const logs: string[] = [];
  let stopped = false;
  const deps = {
    loadProjects: () => projects,
    runLane: async (lane: Lane, name: string): Promise<RunResult> => {
      calls.push(`${lane}:${name}`);
      const r = codes(lane, name, calls.length);
      return typeof r === "number" ? { code: r, timedOut: false } : r;
    },
    backoff: new Backoff(() => 0),
    events: { append: (e: NewEvent) => void events.push(e) },
    log: (m: string) => void logs.push(m),
    stopped: () => stopped,
  };
  return { deps, calls, events, logs, stop: () => (stopped = true) };
}

describe("runPass", () => {
  it("goes lane by lane, downstream first, with projects in name order", async () => {
    const h = harness([project("zeta"), project("alpha")]);
    await runPass(h.deps);
    expect(h.calls).toEqual(["review:alpha", "review:zeta", "qa:alpha", "qa:zeta", "build:alpha", "build:zeta"]);
  });

  it("skips disabled projects and disabled lanes", async () => {
    const h = harness([project("a", { enabled: false }), project("b", { lanes: { qa: false } })]);
    await runPass(h.deps);
    expect(h.calls).toEqual(["review:b", "build:b"]);
  });

  it("stops starting runs once asked to stop", async () => {
    const h = harness([project("a"), project("b")], (_l, _p, n) => {
      if (n === 1) h.stop();
      return 0;
    });
    await runPass(h.deps);
    expect(h.calls).toEqual(["review:a"]);
  });

  it("ignores the result of a run that was cut short by shutdown", async () => {
    const h = harness([project("a")], () => {
      h.stop();
      return { code: null, timedOut: false };
    });
    await runPass(h.deps);
    expect(h.deps.backoff.due("a", "review", JSON.stringify(project("a")))).toBe(true);
  });

  it("pauses a project that is not logged in, and records why", async () => {
    const h = harness([project("a")], () => 69);
    await runPass(h.deps);
    expect(h.calls).toEqual(["review:a"]); // the pause stops the other lanes of that project
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ project: "a", lane: "system", type: "paused" });
    expect(h.events[0]?.message).toMatch(/exit 69/);
  });

  it("backs a failing build off instead of retrying it at once", async () => {
    const h = harness([project("a")], (lane) => (lane === "build" ? 1 : 0));
    await runPass(h.deps);
    const first = h.calls.length;
    await runPass(h.deps); // the clock is frozen at 0, so build is still waiting
    expect(h.calls.slice(first)).toEqual(["review:a", "qa:a"]);
  });

  it("counts a timeout as no progress", async () => {
    const h = harness([project("a", { lanes: { review: false, qa: false } })], () => ({ code: null, timedOut: true }));
    await runPass(h.deps);
    await runPass(h.deps);
    expect(h.calls).toEqual(["build:a"]);
  });
});

describe("runScheduler", () => {
  const settings = { enabled: true, intervalMs: 5 * MIN, runTimeoutMs: 120 * MIN };

  it("runs passes with the interval between them until shutdown", async () => {
    const stop = new AbortController();
    const sleeps: number[] = [];
    const calls: string[] = [];
    const events: NewEvent[] = [];
    await runScheduler({
      settings,
      loadProjects: () => [project("a", { lanes: { review: false, qa: false } })],
      runLane: async (lane, name) => (calls.push(`${lane}:${name}`), ok),
      events: { append: (e) => void events.push(e) },
      log: () => undefined,
      shutdown: stop.signal,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 3) stop.abort();
      },
    });
    expect(calls).toEqual(["build:a", "build:a", "build:a"]);
    expect(sleeps).toEqual([5 * MIN, 5 * MIN, 5 * MIN]);
    expect(events[0]).toMatchObject({ lane: "system", type: "started" });
  });

  it("survives a registry that cannot be read and tries again next pass", async () => {
    const stop = new AbortController();
    const logs: string[] = [];
    let reads = 0;
    await runScheduler({
      settings,
      loadProjects: () => {
        if (++reads === 1) throw new Error("projects/a.json: bad");
        return [];
      },
      runLane: async () => ok,
      events: { append: () => undefined },
      log: (m) => void logs.push(m),
      shutdown: stop.signal,
      sleep: async () => {
        if (reads === 2) stop.abort();
      },
    });
    expect(logs.some((l) => l.includes("pass skipped: projects/a.json: bad"))).toBe(true);
    expect(reads).toBe(2);
  });

  it("records an unreadable registry once, not on every pass", async () => {
    const stop = new AbortController();
    const events: NewEvent[] = [];
    let passes = 0;
    await runScheduler({
      settings,
      loadProjects: () => {
        throw new Error("projects/a.json: bad");
      },
      runLane: async () => ok,
      events: { append: (e) => void events.push(e) },
      log: () => undefined,
      shutdown: stop.signal,
      sleep: async () => {
        if (++passes === 3) stop.abort();
      },
    });
    expect(events.filter((e) => e.type === "failed")).toHaveLength(1);
  });

  it("only waits for shutdown when it is switched off", async () => {
    const stop = new AbortController();
    const logs: string[] = [];
    let ran = false;
    const done = runScheduler({
      settings: { ...settings, enabled: false },
      loadProjects: () => ((ran = true), []),
      runLane: async () => ((ran = true), ok),
      events: { append: () => undefined },
      log: (m) => void logs.push(m),
      shutdown: stop.signal,
    });
    await new Promise((r) => setTimeout(r, 30));
    stop.abort();
    await done;
    expect(ran).toBe(false);
    expect(logs[0]).toMatch(/off/);
  });
});

describe("childLaneRunner", () => {
  const node = (script: string) => (): [string, string[]] => [process.execPath, ["-e", script]];
  const never = new AbortController().signal;

  it("returns the exit code of the child", async () => {
    const run = childLaneRunner(10_000, never, node("process.exit(2)"));
    expect(await run("qa", "a")).toEqual({ code: 2, timedOut: false });
  });

  it("passes the lane and the project to the child", async () => {
    const run = childLaneRunner(10_000, never, (lane, name) => [
      process.execPath,
      ["-e", "process.exit(process.argv[1] === process.argv[3] && process.argv[2] === process.argv[4] ? 0 : 9)", lane, name, "review", "demo"],
    ]);
    expect((await run("review", "demo")).code).toBe(0);
  });

  it("kills a run that outlasts the timeout", async () => {
    const run = childLaneRunner(150, never, node("setInterval(() => {}, 1000)"));
    expect((await run("build", "a")).timedOut).toBe(true);
  });

  it("stops the child on shutdown", async () => {
    const stop = new AbortController();
    const run = childLaneRunner(60_000, stop.signal, node("setInterval(() => {}, 1000)"));
    const pending = run("build", "a");
    setTimeout(() => stop.abort(), 150);
    const result = await pending;
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
  });

  it("reports a command that cannot start as no exit code", async () => {
    const run = childLaneRunner(10_000, never, () => ["definitely-not-a-program-xyz", []]);
    expect((await run("build", "a")).code).toBeNull();
  });
});

describe("the real command", () => {
  const bin = join(REPO_ROOT, "runner", "src", "bin.ts");
  const env = { ...process.env, SCHEDULER_ENABLED: "false", FACTORY_PROJECTS_DIR: join(REPO_ROOT, "projects"), FACTORY_DATA: join(tmpdir(), "factory-sched-test") };

  it("stays alive while the scheduler is off, and exits cleanly on SIGTERM", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", bin, "schedule"], { env, stdio: "ignore", cwd: REPO_ROOT });
    const exited = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
    await new Promise((r) => setTimeout(r, 2500));
    expect(child.exitCode).toBeNull(); // an idle container that exits would be restarted in a loop
    child.kill("SIGTERM");
    // Windows has no SIGTERM: kill() there ends the process outright, so a clean exit code is only checked elsewhere.
    const code = await exited;
    if (process.platform !== "win32") expect(code).toBe(0);
  }, 20_000);
});

describe("stopping a run", () => {
  it("takes the processes the run started down with it, not just the run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "factory-orphan-"));
    const pidFile = join(dir, "grandchild.pid");
    const script = `const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});require("node:fs").writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000)`;
    const run = childLaneRunner(1500, new AbortController().signal, () => [process.execPath, ["-e", script]]);
    const result = await run("build", "a");
    expect(result.timedOut).toBe(true);
    const pid = Number(readFileSync(pidFile, "utf8"));
    await new Promise((r) => setTimeout(r, 300));
    const alive = (() => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    })();
    rmSync(dir, { recursive: true, force: true });
    if (alive) process.kill(pid, "SIGKILL");
    expect(alive).toBe(false);
  }, 20_000);
});
