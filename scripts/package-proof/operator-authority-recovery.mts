import assert from "node:assert/strict";

import { jsonPackageProbe } from "./package-probes.mts";

export function proveOperatorAuthorityRecovery({
  fixture,
  originalPassword,
  port,
  serviceName,
}: {
  fixture: import("./package-fixture.mts").PackageFixture;
  originalPassword: string;
  port: string;
  serviceName: string;
}) {
  const preparedRecovery = jsonPackageProbe(
    fixture,
    "prepare-authority-recovery.mjs",
    [port],
    `${originalPassword}\n`,
  ) as {
    failedLoginStatus: number;
    loginStatus: number;
    tokenStatus: number;
  };
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
        "src/recover-operator-authority.ts",
      ],
      `${recoveryPassword}\n`,
    ),
    '{"status":"operator_authority_recovered"}',
  );
  fixture.runCompose(["up", "--detach", "--wait", "--force-recreate"]);
  const recoveryDatabaseFacts = jsonPackageProbe(
    fixture,
    "database-facts.mjs",
  ) as {
    activeBrowserSessions: number;
    activeImplementerToken: boolean;
    failedLoginAttempts: string | null;
    failedLoginUntil: string | null;
  };
  assert.equal(recoveryDatabaseFacts.activeBrowserSessions, 0);
  assert.equal(recoveryDatabaseFacts.activeImplementerToken, false);
  assert.equal(recoveryDatabaseFacts.failedLoginAttempts, null);
  assert.equal(recoveryDatabaseFacts.failedLoginUntil, null);
  const originalPasswordStatus = jsonPackageProbe(
    fixture,
    "operator-password-status.mjs",
    undefined,
    `${originalPassword}\n`,
  ) as { authenticated: boolean };
  const replacementPasswordStatus = jsonPackageProbe(
    fixture,
    "operator-password-status.mjs",
    undefined,
    `${recoveryPassword}\n`,
  ) as { authenticated: boolean };
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
