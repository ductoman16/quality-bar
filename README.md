# quality-bar

An AI code review management and execution platform

## Host provisioning

Quality Bar has one fixed Codex-authentication location: `/var/lib/quality-bar/codex-home`.
Before starting the service, make the fixed configuration and master-key files readable only by the service account, then provision that persistent service-account login with:

```sh
chown 10001:10001 "$QUALITY_BAR_CONFIG_FILE" "$QUALITY_BAR_MASTER_KEY_FILE"
chmod 0400 "$QUALITY_BAR_CONFIG_FILE" "$QUALITY_BAR_MASTER_KEY_FILE"
docker compose run --rm --no-deps quality-bar codex login --device-auth
```

The command writes only to the named state volume. A missing or invalid login leaves the durable System surface available but marks Codex unavailable and gates every new Codex start; it does not use an environment token, another home directory, or a fallback provider.

## Operator password bootstrap

Before starting Quality Bar for the first time, set the single operator password from the host. Keep the service stopped while the command runs so it can take the installation lock:

```sh
docker compose run --rm --no-deps quality-bar node src/bootstrap-operator-password.js
```

Enter the password at the terminal, or pipe it on standard input. It must contain at least 15 characters. The command takes no password argument and reads no password environment variable; it stores only a salted memory-hard verifier. It succeeds only when no operator password exists.

## Operator authority recovery

If the operator password is lost, stop Quality Bar and replace it from the host:

```sh
docker compose run --rm --no-deps quality-bar node src/recover-operator-authority.js
```

Enter the replacement password at the terminal, or pipe it on standard input. The command takes no password argument and reads no password environment variable. It atomically replaces the password verifier, revokes every browser session and the active implementer token, and clears the failed-login delay. Machine access remains disabled until the operator creates a new implementer token through the authenticated product surface.

The host firewall must allow valid-TLS egress only to OpenAI/Codex, configured Forge APIs, and registered HTTPS Git endpoints. A private Forge may use the single operator-mounted CA bundle; Quality Bar does not add an outbound proxy or trust another certificate source.

## Complete installation deletion

To remove all Quality Bar-owned application state, stop the service first and run the explicit deletion command:

```sh
docker compose stop quality-bar
docker compose run --rm --no-deps quality-bar node src/delete-installation.js
```

The command fails while the service holds the installation lock. On success it clears the SQLite state and persistent Codex login, disposable checkouts, and local backup contents. Configuration, the installation master-key file, and operator-managed off-host copies are outside the deletion boundary and remain the operator's responsibility.

## Versioned upgrades and rollback

Set `QUALITY_BAR_VERSION` to the explicit image version being deployed, then pull and start that image:

```sh
docker compose pull quality-bar
docker compose up --detach --wait
```

Startup holds the installation lock, validates the owned filesystems, requires a validated prior-image backup, creates and integrity-checks a pre-migration snapshot when the schema is older, applies only the ordered forward migration, validates the resulting schema, and starts product work only after every check succeeds. There is no automatic update, downgrade migration, dual-schema compatibility, partial migration, or fallback image. A failure leaves liveness available for diagnosis, readiness unavailable with the exact owning error, and the pre-migration snapshot retained.

If a schema-changing upgrade must be rolled back, stop the service, set `QUALITY_BAR_VERSION` back to the prior image, and restore the retained pre-migration manifest offline:

```sh
docker compose stop quality-bar
docker compose run --rm --no-deps quality-bar node src/restore-backup.js /var/backups/quality-bar/quality-bar-pre-migration-<timestamp>.json
docker compose up --detach --wait
```

The prior image, original installation key, and a newly supplied operator password are required. Offline restore validates the snapshot before publication, revokes existing browser and machine authority, and requires a fresh discovery baseline. If the schema did not change, selecting the prior explicit image is sufficient; no restore migration is performed.
