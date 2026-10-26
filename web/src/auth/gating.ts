import type { Role } from "./users";

/**
 * Where a logged-in user must go before seeing the board, or null when nothing blocks them.
 * One state at a time, in a fixed order: the screens that prove who you are come first. Email verification
 * joins this list in a later step, between the password change and MFA enrolment.
 */
export function gateRedirect(user: {
  mustChangePassword: boolean;
  roles: readonly Role[];
  mfaPending?: boolean;
  needsMfaSetup?: boolean;
}): string | null {
  if (user.mfaPending) return "/login/mfa";
  if (user.mustChangePassword) return "/account/password";
  if (user.needsMfaSetup) return "/account/mfa/setup";
  if (user.roles.length === 0) return "/waiting";
  return null;
}
