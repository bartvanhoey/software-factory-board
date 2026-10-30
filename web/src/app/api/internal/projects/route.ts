import { getRunnerTokenDigest } from "@/auth/config";
import { getDb } from "@/auth/db";
import { isRunner, projectsPayload } from "@/auth/internal-api";

// Without this Next would prerender the handler at build time and serve the projects as they were then.
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };
let lastWarning = 0;

/**
 * The project list for the runner (ADR 0001). It has no session: the runner presents RUNNER_API_TOKEN as a bearer token.
 * Every failure looks the same, and nothing here sets CORS headers, so a web page cannot read it.
 */
export function GET(request: Request): Response {
  if (!isRunner(request.headers.get("authorization"), getRunnerTokenDigest())) {
    // Once a minute at most, so a loop of bad requests cannot flood the log. No header or token is ever logged.
    if (Date.now() - lastWarning > 60_000) {
      lastWarning = Date.now();
      console.warn("[api] a request to the internal projects endpoint was refused");
    }
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { ...HEADERS, "WWW-Authenticate": "Bearer" } });
  }
  try {
    return Response.json(projectsPayload(getDb()), { headers: HEADERS });
  } catch (err) {
    console.error(`[api] the internal projects endpoint failed: ${err instanceof Error ? err.message : "unknown error"}`);
    return Response.json({ error: "unavailable" }, { status: 503, headers: HEADERS });
  }
}
