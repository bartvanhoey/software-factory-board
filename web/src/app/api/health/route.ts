import { getDb } from "@/auth/db";

// Without this Next would prerender the handler at build time and always answer "ok".
export const dynamic = "force-dynamic";

/** Public liveness probe for the Docker healthcheck. Says nothing beyond up or down. */
export function GET(): Response {
  const headers = { "Cache-Control": "no-store" };
  try {
    getDb().prepare("SELECT 1").get();
    return Response.json({ status: "ok" }, { headers });
  } catch {
    return Response.json({ status: "error" }, { status: 503, headers });
  }
}
