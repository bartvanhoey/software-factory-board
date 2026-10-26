---
status: accepted
---

# Secrets are encrypted in the database, with the master key kept outside it

GitHub tokens and other credentials are set by the Administrator on the settings page and stored in the database encrypted with AES-256-GCM. The master key (`FACTORY_MASTER_KEY`) comes from an environment variable or Docker secret that the installer generates once. It is never stored in the database or on the data volume, so a stolen volume or backup does not expose the credentials.

## Considered Options

- **Generate the key on first start and store it on the data volume.** Rejected: the key would sit next to the database, so anyone who obtains a volume backup obtains every credential.
- **Store credentials unencrypted in the database.** Rejected for the same reason.

## Consequences

- `.env` cannot become empty: the master key and the first-administrator seed still come from outside the database.
- Losing the master key makes every stored credential unrecoverable; the Administrator must enter them again. The docs must tell installers to back the key up separately from database backups.
- Credential fields in the UI are write-only: they show "set" or "not set" and never return the value.
