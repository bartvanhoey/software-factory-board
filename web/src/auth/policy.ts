export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

// Length matters more than composition rules. This is a small list of the most common passwords that
// are long enough to pass the length check; it is not a breach database.
const COMMON = new Set([
  "password1234", "password12345", "passwordpassword", "1234567890123", "123456789012", "1234567890ab",
  "qwertyuiop12", "qwertyuiopas", "qwertyuiop123", "asdfghjkl123", "iloveyou1234", "iloveyou12345",
  "letmein12345", "welcome12345", "welcome1234", "changeme1234", "changemenow1", "administrator",
  "administrator1", "admin12345678", "adminadmin123", "abcdefghijkl", "abcd12345678", "abc123456789",
  "trustno1trustno1", "passw0rd1234", "p@ssw0rd1234", "p@ssword1234", "monkey123456", "dragon123456",
  "football1234", "baseball1234", "superman1234", "sunshine1234", "princess1234", "whatever1234",
  "123123123123", "111111111111", "000000000000", "aaaaaaaaaaaa", "correcthorsebatterystaple",
  "softwarefactory", "factory123456", "factoryfactory",
]);

/** Null when the password is acceptable, otherwise a message for the user. */
export function checkPassword(password: string, email?: string): string | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const lower = password.normalize("NFKC").toLowerCase();
  if (COMMON.has(lower)) return "That password is too common. Choose another.";
  if (email && lower === email.toLowerCase()) return "The password cannot be your email address.";
  return null;
}
