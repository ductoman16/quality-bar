import assert from "node:assert/strict";

import { jsonPackageProbe, runPackageProbe } from "./package-probes.mts";

export type DatabaseFacts = {
  activeBrowserSessions: number;
  activeImplementerToken: boolean;
  databaseVersion: string;
  failedLoginAttempts: string | null;
  failedLoginUntil: string | null;
  foreignKeys: boolean;
  installationKeyVerifier: string;
  integrity: string;
  journalMode: string;
  operatorPasswordVerifier: string | null;
  persistedMarker: string | null;
  restoredDiscovery: { forgejo: string | null; github: string | null };
  synchronous: string;
};

export type AuthenticatedHttpSmoke = {
  browserStatus: number;
  codexCapabilityCatalogVersion: string;
  hasCodexCapabilityModels: boolean;
  hasNavigation: boolean;
  loginStatus: number;
  mcpRepositoryCount: number;
  mcpStatus: number;
  mcpTool: string;
  openapiStatus: number;
  openapiVersion: string;
  repositoryCount: number;
  repositoryListStatus: number;
  storage: {
    filesystems: {
      available_bytes: number;
      filesystem: string;
      path: string;
      status: string;
    }[];
    reserve_bytes: number;
    status: string;
    cleanup: {
      artifacts_removed: number;
      error: { code: string; detail: string } | null;
      last_run_at: string | null;
      sessions_removed: number;
      status: string;
    };
  };
  tokenStatus: number;
};

export function provePackageOfflineRestore({
  fixture,
  recoveryPassword,
}: {
  fixture: import("./package-fixture.mts").PackageFixture;
  recoveryPassword: string;
}) {
  const { environment, serviceName } = fixture;
  assert.deepEqual(
    jsonPackageProbe(
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
  const restoreSnapshot = jsonPackageProbe(
    fixture,
    "create-restore-snapshot.mjs",
    [fixture.applicationVersion, fixture.masterKey],
  ) as { manifestPath: string };
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
        "src/restore-backup.ts",
        restoreSnapshot.manifestPath,
      ],
      `${restorePassword}\n`,
    ),
    `{"applicationVersion":"${fixture.applicationVersion}","status":"restored"}`,
  );
  fixture.runCompose(["up", "--detach", "--wait", "--force-recreate"]);
  const restoredDatabaseFacts = jsonPackageProbe(
    fixture,
    "database-facts.mjs",
  ) as DatabaseFacts;
  assert.equal(restoredDatabaseFacts.persistedMarker, "survived");
  assert.equal(restoredDatabaseFacts.activeBrowserSessions, 0);
  assert.equal(restoredDatabaseFacts.activeImplementerToken, false);
  assert.deepEqual(restoredDatabaseFacts.restoredDiscovery, {
    forgejo: "pending",
    github: "pending",
  });
  const snapshotPasswordStatus = jsonPackageProbe(
    fixture,
    "operator-password-status.mjs",
    undefined,
    `${recoveryPassword}\n`,
  ) as { authenticated: boolean };
  const restorePasswordStatus = jsonPackageProbe(
    fixture,
    "operator-password-status.mjs",
    undefined,
    `${restorePassword}\n`,
  ) as { authenticated: boolean };
  assert.deepEqual(snapshotPasswordStatus, { authenticated: false });
  assert.deepEqual(restorePasswordStatus, { authenticated: true });
  const authenticatedHttpSmoke = jsonPackageProbe(
    fixture,
    "authenticated-http-smoke.mjs",
    [environment.QUALITY_BAR_HTTP_PORT, "machine"],
    restorePassword,
  ) as AuthenticatedHttpSmoke;
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
