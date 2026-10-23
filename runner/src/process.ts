import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Written to the process's stdin, so long text never goes through argv or a shell. */
  input?: string;
  /** Output is appended here as well as returned. */
  logFile?: string;
  timeoutMs?: number;
}

function appendLog(file: string | undefined, text: string): void {
  if (!file || text.length === 0) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, text);
}

function collect(child: ReturnType<typeof spawn>, label: string, opts: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : undefined;
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
      appendLog(opts.logFile, d.toString());
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      appendLog(opts.logFile, d.toString());
    });
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`failed to start ${label}: ${e.message}`));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    else child.stdin?.end();
  });
}

/** Run a program with an argument array: no shell, so no quoting problems and no injection. */
export function runProcess(file: string, args: readonly string[], opts: ProcessOptions = {}): Promise<ProcessResult> {
  const child = spawn(file, [...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  return collect(child, file, opts);
}

/** Run a trusted command line (from the project registry) through the platform shell. */
export function runShellCommand(command: string, opts: ProcessOptions = {}): Promise<ProcessResult> {
  const child = spawn(command, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
  });
  return collect(child, command, opts);
}

/** stdout of a process that must succeed; throws with its stderr otherwise. */
export async function mustRun(file: string, args: readonly string[], opts: ProcessOptions = {}): Promise<string> {
  const result = await runProcess(file, args, opts);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().split("\n").slice(-3).join(" | ");
    throw new Error(`${file} ${args.slice(0, 2).join(" ")} failed (exit ${result.code}): ${detail}`);
  }
  return result.stdout;
}
