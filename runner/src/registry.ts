import { ProjectsResponseSchema, type Project } from "@factory/shared";
import { UsageError } from "./errors.js";

export interface RegistrySettings {
  /** The web service's origin, without a path. */
  url: string;
  token: string;
}

/** A problem reaching or understanding the web service. The message never contains the token. */
export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

const TIMEOUT_MS = 10_000;

/** ADR 0001: the project list lives in the web service. Needs RUNNER_API_TOKEN; FACTORY_WEB_URL defaults to the compose service. */
export function loadRegistrySettings(env: NodeJS.ProcessEnv = process.env): RegistrySettings {
  const token = env.RUNNER_API_TOKEN?.trim();
  if (!token) throw new UsageError("RUNNER_API_TOKEN is not set: the runner needs it to fetch the projects from the web service");
  const raw = env.FACTORY_WEB_URL?.trim() || "http://web:2999";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError("FACTORY_WEB_URL must be a full address such as http://web:2999");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new UsageError("FACTORY_WEB_URL must be just an http(s) address, with no path, credentials, query or fragment");
  }
  return { url: url.origin, token };
}

/**
 * Asks the web service for every project (disabled ones included). It never follows a redirect, so the token cannot be
 * sent anywhere but the address it was configured for, and it gives up after ten seconds.
 */
export async function fetchProjects(settings: RegistrySettings, fetchFn: typeof fetch = fetch): Promise<Project[]> {
  let response: Response;
  try {
    response = await fetchFn(`${settings.url}/api/internal/projects`, {
      headers: { Authorization: `Bearer ${settings.token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause?.code ?? (e instanceof Error ? e.name : "error");
    throw new RegistryError(`cannot reach the web service at ${settings.url} (${cause}); the projects are kept there, so no run can start without it`);
  }
  if (response.status === 401) throw new RegistryError("the web service refused RUNNER_API_TOKEN: it must be the same value in the runner's and the web service's environment");
  if (!response.ok) throw new RegistryError(`the web service answered ${response.status} when asked for the projects`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RegistryError("the web service sent an answer that is not JSON");
  }
  const parsed = ProjectsResponseSchema.safeParse(body);
  if (!parsed.success) throw new RegistryError("the web service sent a project list this runner does not understand (are the two versions the same?)");
  return parsed.data.projects;
}
