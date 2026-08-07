import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {{
 *   fixture: import("./package-fixture.mjs").PackageFixture,
 *   serviceName: string,
 * }} input
 */
export function proveInstallationDeletion({ fixture, serviceName }) {
  const markers = [
    "/var/lib/quality-bar/deletion-state-marker",
    "/var/lib/quality-bar/codex-home/auth.json",
    "/var/cache/quality-bar/checkouts/deletion-work/deletion-marker",
    "/var/backups/quality-bar/deletion-backup-marker",
  ];
  fixture.runCompose([
    "exec",
    "-T",
    serviceName,
    "mkdir",
    "-p",
    "/var/cache/quality-bar/checkouts/deletion-work",
  ]);
  for (const marker of markers) {
    fixture.runCompose(["exec", "-T", serviceName, "touch", marker]);
  }
  assert.throws(
    () =>
      fixture.runCompose([
        "run",
        "--rm",
        "--no-deps",
        "-T",
        serviceName,
        "node",
        "src/delete-installation.js",
      ]),
    /installation_locked/,
  );
  fixture.runCompose(["stop", serviceName]);

  const deletion = JSON.parse(
    fixture.runCompose([
      "run",
      "--rm",
      "--no-deps",
      "-T",
      serviceName,
      "node",
      "src/delete-installation.js",
    ]),
  );
  assert.deepEqual(deletion, {
    paths: [
      "/var/lib/quality-bar/codex-home",
      "/var/lib/quality-bar",
      "/var/cache/quality-bar/checkouts",
      "/var/backups/quality-bar",
    ],
    status: "installation_deleted",
  });

  for (const marker of markers) {
    assert.equal(
      fixture.runCompose([
        "run",
        "--rm",
        "--no-deps",
        "-T",
        serviceName,
        "test",
        "!",
        "-e",
        marker,
      ]),
      "",
    );
  }
  for (const path of [
    "/var/lib/quality-bar/quality-bar.sqlite3",
    "/var/lib/quality-bar/quality-bar.sqlite3-wal",
    "/var/lib/quality-bar/quality-bar.sqlite3-shm",
  ]) {
    assert.equal(
      fixture.runCompose([
        "run",
        "--rm",
        "--no-deps",
        "-T",
        serviceName,
        "test",
        "!",
        "-e",
        path,
      ]),
      "",
    );
  }
  assert.equal(
    fixture.runCompose(["ps", "--status", "running", "-q", serviceName]),
    "",
  );

  return {
    applicationStateRemoved: true,
    codexAuthenticationPathRemoved: true,
    disposableWorkRemoved: true,
    localBackupsRemoved: true,
    externalSourcesPreserved:
      existsSync(join(fixture.fixtureDirectory, "config.env")) &&
      existsSync(join(fixture.fixtureDirectory, "quality-bar-master-key")),
    paths: deletion.paths,
    status: deletion.status,
    stoppedRequired: true,
  };
}
