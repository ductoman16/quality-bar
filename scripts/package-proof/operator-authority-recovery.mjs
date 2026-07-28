import assert from "node:assert/strict";

import { runPackageProbe } from "./package-probes.mjs";

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
 *   originalPassword: string,
 *   port: string,
 *   serviceName: string,
 * }} input
 */
export function proveOperatorAuthorityRecovery({
  fixture,
  originalPassword,
  port,
  serviceName,
}) {
  const preparedRecovery = /** @type {{
   *   failedLoginStatus: number,
   *   loginStatus: number,
   *   tokenStatus: number,
   * }} */ (
    jsonProbe(
      fixture,
      "prepare-authority-recovery.mjs",
      [port],
      `${originalPassword}\n`,
    )
  );
  assert.deepEqual(preparedRecovery, {
    failedLoginStatus: 401,
    loginStatus: 204,
    tokenStatus: 201,
  });
  const recoveryPassword = "a recovered package operator password";
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
        "src/recover-operator-authority.js",
      ],
      `${recoveryPassword}\n`,
    ),
    '{"status":"operator_authority_recovered"}',
  );
  fixture.runCompose(["up", "--detach", "--wait", "--force-recreate"]);
  const recoveryDatabaseFacts = /** @type {{
   *   activeBrowserSessions: number,
   *   activeImplementerToken: boolean,
   *   failedLoginAttempts: string | null,
   *   failedLoginUntil: string | null,
   * }} */ (jsonProbe(fixture, "database-facts.mjs"));
  assert.equal(recoveryDatabaseFacts.activeBrowserSessions, 0);
  assert.equal(recoveryDatabaseFacts.activeImplementerToken, false);
  assert.equal(recoveryDatabaseFacts.failedLoginAttempts, null);
  assert.equal(recoveryDatabaseFacts.failedLoginUntil, null);
  const originalPasswordStatus = /** @type {{authenticated: boolean}} */ (
    jsonProbe(
      fixture,
      "operator-password-status.mjs",
      undefined,
      `${originalPassword}\n`,
    )
  );
  const replacementPasswordStatus = /** @type {{authenticated: boolean}} */ (
    jsonProbe(
      fixture,
      "operator-password-status.mjs",
      undefined,
      `${recoveryPassword}\n`,
    )
  );
  assert.deepEqual(originalPasswordStatus, { authenticated: false });
  assert.deepEqual(replacementPasswordStatus, { authenticated: true });
  return {
    recoveryDatabaseFacts,
    recoveryPassword,
    recoveryPasswordStatus: {
      originalAuthenticated: originalPasswordStatus.authenticated,
      replacementAuthenticated: replacementPasswordStatus.authenticated,
    },
  };
}
