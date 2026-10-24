import { describe, expect, it } from "vitest";
import { isSecretPath } from "./secrets.js";

describe("isSecretPath", () => {
  it.each([".env", ".env.local", ".env.production", "app/.env", "config\\.env", "tls/server.pem", "keys/api.key", "cert.pfx", "store.p12", "id_rsa", "home/.ssh/id_ed25519", "ID_RSA"])(
    "flags %s",
    (path) => expect(isSecretPath(path)).toBe(true),
  );

  it.each([".env.example", ".env.sample", ".env.template", "src/Program.cs", "docs/environment.md", "id_rsa.pub", "keyboard.ts", "monkey.keys", "wwwroot/css/site.css"])(
    "lets %s through",
    (path) => expect(isSecretPath(path)).toBe(false),
  );
});
