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

Enter the password at the terminal, or pipe it on standard input. It must contain at least 15 characters. The command takes no password argument and reads no password environment variable; it stores only a salted memory-hard verifier. It succeeds only when no operator password exists. Host control is the recovery authority; recovery and browser-session or implementer-token invalidation are introduced by their owning later slices.

The host firewall must allow valid-TLS egress only to OpenAI/Codex, configured Forge APIs, and registered HTTPS Git endpoints. A private Forge may use the single operator-mounted CA bundle; Quality Bar does not add an outbound proxy or trust another certificate source.
