import type { Role } from "./users";

/**
 * Where a logged-in user must go before seeing the board, or null when nothing blocks them.
 * One state at a time, in a fixed order. MFA and email verification join this list in later steps.
 */
export function gateRedirect(user: { mustChangePassword: boolean; roles: readonly Role[] }): string | null {
  if (user.mustChangePassword) return "/account/password";
  if (user.roles.length === 0) return "/waiting";
  return null;
}
