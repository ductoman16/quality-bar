import assert from "node:assert/strict";

import { runPackageProbe } from "./package-probes.mjs";

/**
 * @typedef {{
 *   activeBrowserSessions: number,
 *   activeImplementerToken: boolean,
 *   databaseVersion: string,
 *   failedLoginAttempts: string | null,
 *   failedLoginUntil: string | null,
 *   foreignKeys: boolean,
 *   installationKeyVerifier: string,
 *   integrity: string,
 *   journalMode: string,
 *   operatorPasswordVerifier: string | null,
 *   persistedMarker: string | null,
 *   schemaVersion: number,
 *   synchronous: string,
 * }} DatabaseFacts
 */
/**
 * @typedef {{
 *   browserStatus: number,
 *   codexCapabilityCatalogVersion: string,
 *   hasCodexCapabilityModels: boolean,
 *   hasNavigation: boolean,
 *   loginStatus: number,
 *   openapiStatus: number,
 *   openapiVersion: string,
 *   storage: {
 *     filesystems: {available_bytes: number, filesystem: string, path: string, status: string}[],
 *     reserve_bytes: number,
 *     status: string
 *   },
 * }} AuthenticatedHttpSmoke
 */

/**
 * @param {import("./package-fixture.mjs").PackageFixture} fixture
 * @param {string} name
 * @param {string[]} [arguments_]
 * @param {string} [input]
 */
function jsonProbe(fixture, name, arguments_, input) {
  return JSON.parse(runPackageProbe(fixture, name, arguments_, input));
}

/**
 * @param {{
 *   fixture: import("./package-fixture.mjs").PackageFixture,
 *   recoveryPassword: string,
 *   schemaVersion: number,
 * }} input
 */
export function provePackageOfflineRestore({
  fixture,
  recoveryPassword,
  schemaVersion,
}) {
  const { environment, serviceName } = fixture;
  assert.deepEqual(
    jsonProbe(
      fixture,
      "prepare-authority-recovery.mjs",
      [environment.QUALITY_BAR_HTTP_PORT],
      `${recoveryPassword}\n`,
    ),
    {
      failedLoginStatus: 401,
      loginStatus: 204,
      tokenStatus: 201,
    },
  );
  const restoreSnapshot = /** @type {{manifestPath: string}} */ (
    jsonProbe(fixture, "create-restore-snapshot.mjs", [
      fixture.applicationVersion,
      fixture.masterKey,
    ])
  );
  assert.match(
    restoreSnapshot.manifestPath,
    /^\/var\/backups\/quality-bar\/quality-bar-daily-.+\.json$/,
  );
  runPackageProbe(fixture, "write-post-backup-marker.mjs");
  const restorePassword = "a newly restored package operator password";
  fixture.runCompose(["stop", serviceName]);
  assert.equal(
    fixture.runCompose(
      [
        "run",
        "--rm",
        "--no-deps",
        "-T",
        serviceName,
        "node",
        "src/restore-backup.js",
        restoreSnapshot.manifestPath,
      ],
      `${restorePassword}\n`,
    ),
    `{"applicationVersion":"${fixture.applicationVersion}","schemaVersion":${schemaVersion},"status":"restored"}`,
  );
  fixture.runCompose(["up", "--detach", "--wait", "--force-recreate"]);
  const restoredDatabaseFacts = /** @type {DatabaseFacts} */ (
    jsonProbe(fixture, "database-facts.mjs")
  );
  assert.equal(restoredDatabaseFacts.persistedMarker, "survived");
  assert.equal(restoredDatabaseFacts.activeBrowserSessions, 0);
  assert.equal(restoredDatabaseFacts.activeImplementerToken, false);
  const snapshotPasswordStatus = /** @type {{authenticated: boolean}} */ (
    jsonProbe(
      fixture,
      "operator-password-status.mjs",
      undefined,
      `${recoveryPassword}\n`,
    )
  );
  const restorePasswordStatus = /** @type {{authenticated: boolean}} */ (
    jsonProbe(
      fixture,
      "operator-password-status.mjs",
      undefined,
      `${restorePassword}\n`,
    )
  );
  assert.deepEqual(snapshotPasswordStatus, { authenticated: false });
  assert.deepEqual(restorePasswordStatus, { authenticated: true });
  const authenticatedHttpSmoke = /** @type {AuthenticatedHttpSmoke} */ (
    jsonProbe(
      fixture,
      "authenticated-http-smoke.mjs",
      [environment.QUALITY_BAR_HTTP_PORT],
      restorePassword,
    )
  );
  assert.equal(authenticatedHttpSmoke.loginStatus, 204);
  return {
    authenticatedHttpSmoke,
    restorePassword,
    restorePasswordStatus: {
      newAuthenticated: restorePasswordStatus.authenticated,
      snapshotAuthenticated: snapshotPasswordStatus.authenticated,
    },
    restoredDatabaseFacts,
  };
}
