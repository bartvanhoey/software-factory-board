const TEMPLATE_ENV = /\.(example|sample|template|dist)$/;

/**
 * True for a path that looks like a secret: `.env` files (but not `.env.example` and friends),
 * private keys and certificate stores. The build lane refuses to commit these for the builder.
 */
export function isSecretPath(path: string): boolean {
  const name = (path.replace(/\\/g, "/").split("/").pop() ?? "").toLowerCase();
  if (name === ".env" || name.startsWith(".env.")) return !TEMPLATE_ENV.test(name);
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(name)) return !name.endsWith(".pub");
  return /\.(pem|key|pfx|p12)$/.test(name);
}
