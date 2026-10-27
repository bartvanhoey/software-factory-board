import { describe, expect, it } from "vitest";
import type { SmtpConfig } from "./config";
import { createSmtpMailer, transportOptions } from "./mail";

const SMTP: SmtpConfig = { host: "smtp.example.com", port: 587, user: "mailer", password: "s3cret", from: "factory@example.com" };

describe("transportOptions", () => {
  it("uses implicit TLS on port 465", () => {
    expect(transportOptions({ ...SMTP, port: 465 })).toMatchObject({ secure: true, requireTLS: false });
  });

  it.each([587, 25, 2525, 1025])("requires STARTTLS on port %i, and has no plaintext option", (port) => {
    const o = transportOptions({ ...SMTP, port });
    expect(o).toMatchObject({ secure: false, requireTLS: true });
    expect(Object.keys(o)).not.toContain("ignoreTLS");
  });

  it("always verifies the certificate and refuses old TLS versions", () => {
    for (const port of [465, 587]) expect(transportOptions({ ...SMTP, port }).tls).toEqual({ minVersion: "TLSv1.2", rejectUnauthorized: true });
  });

  it("passes the host, port and credentials, and sets timeouts so a slow relay cannot hold a request open", () => {
    const o = transportOptions(SMTP);
    expect(o).toMatchObject({ host: "smtp.example.com", port: 587, auth: { user: "mailer", pass: "s3cret" } });
    for (const t of [o.connectionTimeout, o.greetingTimeout, o.socketTimeout]) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(30_000);
    }
  });

  it("forbids messages from reading local files or URLs", () => {
    expect(transportOptions(SMTP)).toMatchObject({ disableFileAccess: true, disableUrlAccess: true });
  });
});

describe("createSmtpMailer", () => {
  function fake() {
    const sent: { from: string; to: { name: string; address: string }; subject: string; text: string }[] = [];
    let options: unknown;
    const mailer = createSmtpMailer(SMTP, (o) => {
      options = o;
      return { sendMail: async (m) => void sent.push(m) };
    });
    return { mailer, sent, options: () => options };
  }

  it("sends plain text from the configured sender to one recipient given as an address object", async () => {
    const f = fake();
    await f.mailer.send({ to: "person@example.com", subject: "Hello", text: "Body" });
    expect(f.sent).toEqual([{ from: "factory@example.com", to: { name: "", address: "person@example.com" }, subject: "Hello", text: "Body" }]);
    expect(Object.keys(f.sent[0]!)).not.toContain("html");
  });

  it("builds its transport from the validated settings", () => {
    const f = fake();
    expect(f.options()).toEqual(transportOptions(SMTP));
  });

  it.each([
    "a@b.co,evil@x.com",
    "a,b@c.co",
    "a@b.co;evil@x.com",
    "Name <a@b.co>",
    "a@b.co\r\nBcc: evil@x.com",
    "a b@c.co",
    "a@b@c.co",
    "",
    "no-at-sign",
    '"quoted"@b.co',
  ])("refuses a recipient that could be a list or carry headers: %j", async (to) => {
    const f = fake();
    await expect(f.mailer.send({ to, subject: "s", text: "t" })).rejects.toThrow("single plain address");
    expect(f.sent).toEqual([]);
  });

  it("gives up on a relay that never finishes, instead of holding the request open", async () => {
    const never = createSmtpMailer(SMTP, () => ({ sendMail: () => new Promise<unknown>(() => {}) }), 30);
    await expect(never.send({ to: "a@b.co", subject: "s", text: "t" })).rejects.toThrow("mail send timed out");
  });

  it("does not time out a send that finishes in time", async () => {
    const quick = createSmtpMailer(SMTP, () => ({ sendMail: async () => "ok" }), 1000);
    await expect(quick.send({ to: "a@b.co", subject: "s", text: "t" })).resolves.toBeUndefined();
  });

  it("passes a relay failure on to the caller", async () => {
    const mailer = createSmtpMailer(SMTP, () => ({ sendMail: async () => { throw new Error("connection refused"); } }));
    await expect(mailer.send({ to: "a@b.co", subject: "s", text: "t" })).rejects.toThrow("connection refused");
  });
});
