import assert from "node:assert/strict";

/**
 * @typedef {{
 *   source?: string,
 *   target: string,
 *   type: string,
 *   volume?: object,
 *   read_only?: boolean,
 * }} ComposeVolume
 */

/**
 * @typedef {{
 *   services: Record<string, {
 *     platform: string,
 *     image: string,
 *     cap_add: string[],
 *     profiles?: unknown,
 *     depends_on?: unknown,
 *     stop_grace_period?: string,
 *     ports: string[],
 *     security_opt: string[],
 *     volumes: ComposeVolume[],
 *   }>,
 *   volumes: Record<string, object>,
 * }} ComposeConfiguration
 */

/**
 * @param {import("./package-fixture.mjs").PackageFixture} fixture
 * @returns {ComposeConfiguration}
 */
export function assertComposeConfiguration(fixture) {
  /** @type {ComposeConfiguration} */
  const configuration = JSON.parse(
    fixture.runCompose(["config", "--format", "json"]),
  );
  const { serviceName } = fixture;

  assert.deepEqual(Object.keys(configuration.services), [serviceName]);
  assert.equal(configuration.services[serviceName].platform, "linux/amd64");
  assert.equal(
    configuration.services[serviceName].image,
    `${fixture.imageRepository}:${fixture.applicationVersion}`,
  );
  assert.equal(configuration.services[serviceName].profiles, undefined);
  assert.equal(configuration.services[serviceName].depends_on, undefined);

  assert.deepEqual(configuration.services[serviceName].cap_add, [
    "SETGID",
    "SETUID",
    "SYS_ADMIN",
    "SYS_CHROOT",
    "SYS_PTRACE",
  ]);
  assert.deepEqual(configuration.services[serviceName].security_opt, [
    "apparmor=unconfined",
    "seccomp=unconfined",
  ]);
  assert.equal(configuration.services[serviceName].stop_grace_period, "15m5s");
  const ports = configuration.services[serviceName].ports;
  assert.deepEqual(ports, [
    `${fixture.environment.QUALITY_BAR_HTTP_PORT}:${fixture.environment.QUALITY_BAR_HTTP_PORT}`,
  ]);

  const serviceVolumes = configuration.services[serviceName].volumes;
  assert.deepEqual(
    serviceVolumes.slice(0, 3).map((volume) => ({
      source: volume.source,
      target: volume.target,
      type: volume.type,
      volume: volume.volume,
    })),
    [
      {
        source: "quality-bar-state",
        target: "/var/lib/quality-bar",
        type: "volume",
        volume: {},
      },
      {
        source: "quality-bar-checkouts",
        target: "/var/cache/quality-bar/checkouts",
        type: "volume",
        volume: {},
      },
      {
        source: "quality-bar-backups",
        target: "/var/backups/quality-bar",
        type: "volume",
        volume: {},
      },
    ],
  );
  assert.deepEqual(
    serviceVolumes.slice(3).map((volume) => ({
      readOnly: volume.read_only,
      target: volume.target,
      type: volume.type,
    })),
    [
      {
        readOnly: true,
        target: "/etc/quality-bar/config.env",
        type: "bind",
      },
      {
        readOnly: true,
        target: "/run/secrets/quality-bar-master-key",
        type: "bind",
      },
    ],
  );
  assert.deepEqual(Object.keys(configuration.volumes), [
    "quality-bar-backups",
    "quality-bar-checkouts",
    "quality-bar-state",
  ]);
  assert.throws(
    () =>
      fixture.runDocker([
        "build",
        "--platform",
        "linux/amd64",
        "--output",
        "type=cacheonly",
        ".",
      ]),
    /QUALITY_BAR_VERSION must be a semantic version/,
  );

  return configuration;
}
