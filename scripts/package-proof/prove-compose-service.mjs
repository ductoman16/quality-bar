import assert from "node:assert/strict";

import { proveBundledTools } from "./bundled-tools.mjs";
import { provePackageOfflineRestore } from "./offline-restore.mjs";
import { proveOwnedArtifactCleanup } from "./owned-artifact-cleanup.mjs";
import { proveOperatorAuthorityRecovery } from "./operator-authority-recovery.mjs";
import { proveRetention } from "./retention.mjs";
import { proveInstallationDeletion } from "./installation-deletion.mjs";
import { assertFilesystemFacts } from "./filesystem-facts.mjs";
import { proveGracefulShutdown } from "./graceful-shutdown.mjs";
import { jsonPackageProbe, runPackageProbe } from "./package-probes.mjs";

const serviceFixtureImage =
  "node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd";

/** @typedef {import("./package-fixture.mjs").PackageFixture} PackageFixture */
/** @typedef {import("./compose-configuration.mjs").ComposeConfiguration} ComposeConfiguration */
/**
 * @typedef {{
 *   localFilesystems: boolean,
 *   stateFreeBytes: number,
 *   checkoutsFreeBytes: number,
 *   pathFacts: Record<string, {filesystemType: number, gid: number, mode: number, uid: number}>,
 * }} FilesystemFacts
 */
/**
 * @typedef {{
 *   liveness: {body: {status: string}, status: number},
 *   readiness: {body: {status: string}, status: number},
 *   directSystem: {errorCode: string, status: number},
 *   forwardedSystem: {errorCode: string, status: number},
 * }} HttpFacts
 */
/** @typedef {ReturnType<typeof provePackageOfflineRestore>["restoredDatabaseFacts"]} DatabaseFacts */
/** @typedef {ReturnType<typeof provePackageOfflineRestore>["authenticatedHttpSmoke"]} AuthenticatedHttpSmoke */
/**
 * @typedef {{
 *   api: {errorCode: string, status: number},
 *   browser: {errorCode: string, status: number},
 *   browserAsset: {errorCode: string, status: number},
 *   failedWrite: {errorCode: string, status: number},
 *   liveness: {body: {status: string}, status: number},
 *   mcp: {errorCode: string, status: number},
 *   readiness: {body: {error: string, status: string}, status: number},
 * }} DurableWriteFailureFacts
 */
/**
 * @typedef {{
 *   applicationVersion: string,
 *   count: number,
 *   integrity: string,
 *   keyIdentity: string,
 *   kind: string,
 *   masterKeyCopied: boolean,
 *   schemaVersion: number,
 * }} BackupFacts
 */
/** @typedef {ReturnType<typeof proveInstallationDeletion>} InstallationDeletionFacts */
/** @typedef {ReturnType<typeof proveGracefulShutdown>} GracefulShutdownFacts */

/**
 * @param {{
 *   authenticatedHttpSmoke: AuthenticatedHttpSmoke,
 *   backupFacts: BackupFacts,
 *   configuration: ComposeConfiguration,
 *   durableWriteFailure: DurableWriteFailureFacts,
 *   fixture: PackageFixture,
 *   filesystemFacts: FilesystemFacts,
 *   gracefulShutdown: GracefulShutdownFacts,
 *   httpFacts: HttpFacts,
 *   imagePlatform: string,
 *   installationDeletion: InstallationDeletionFacts,
 *   processArguments: string[],
 *   recoveryDatabaseFacts: DatabaseFacts,
 *   recoveryPasswordStatus: {
 *     originalAuthenticated: boolean,
 *     replacementAuthenticated: boolean,
 *   },
 *   restoredDatabaseFacts: DatabaseFacts,
 *   restorePasswordStatus: {
 *     newAuthenticated: boolean,
 *     snapshotAuthenticated: boolean,
 *   },
 *   toolVersions: {codex: string, git: string},
 *   uid: number,
 * }} facts
 */
function packageFacts({
  authenticatedHttpSmoke,
  backupFacts,
  configuration,
  durableWriteFailure,
  fixture,
  filesystemFacts,
  gracefulShutdown,
  httpFacts,
  imagePlatform,
  installationDeletion,
  processArguments,
  recoveryDatabaseFacts,
  recoveryPasswordStatus,
  restoredDatabaseFacts,
  restorePasswordStatus,
  toolVersions,
  uid,
}) {
  if (restoredDatabaseFacts.operatorPasswordVerifier === null) {
    throw new Error("package_operator_password_verifier_missing");
  }
  const service = configuration.services[fixture.serviceName];
  return {
    serviceCount: Object.keys(configuration.services).length,
    companionServiceCount: 0,
    platform: imagePlatform,
    image: `quality-bar:${fixture.applicationVersion}`,
    applicationProcess: {
      uid,
      pid: 1,
      executable: processArguments[0],
      entrypoint: processArguments.at(-1),
    },
    gracefulShutdown,
    liveness: {
      path: "/health/live",
      httpStatus: httpFacts.liveness.status,
      response: httpFacts.liveness.body,
    },
    readiness: {
      path: "/health/ready",
      httpStatus: httpFacts.readiness.status,
      response: httpFacts.readiness.body,
    },
    storage: {
      backupsPath: "/var/backups/quality-bar",
      checkoutsPath: "/var/cache/quality-bar/checkouts",
      databasePath: "/var/lib/quality-bar/quality-bar.sqlite3",
      localFilesystems: filesystemFacts.localFilesystems,
      ownedPaths: true,
      persistedAcrossRecreate: true,
      volumeTarget: service.volumes[0].target,
    },
    installation: {
      freeSpaceReserveBytes: authenticatedHttpSmoke.storage.reserve_bytes,
      freeSpaceReserveMet:
        authenticatedHttpSmoke.storage.status === "available",
    },
    installationDeletion,
    network: {
      httpBindAddress: "127.0.0.1",
      mode: "bridge",
    },
    tools: { ...toolVersions, persistentCodexLogin: false },
    configuration: {
      configPath: "/etc/quality-bar/config.env",
      encryptedVerifier: /^v1\./.test(
        restoredDatabaseFacts.installationKeyVerifier,
      ),
      masterKeyPath: "/run/secrets/quality-bar-master-key",
    },
    authority: {
      bootstrapVerifierProtected: /^scrypt-v1\./.test(
        restoredDatabaseFacts.operatorPasswordVerifier,
      ),
      operatorAuthorityRecovery: {
        browserSessionsRevoked:
          recoveryDatabaseFacts.activeBrowserSessions === 0,
        failedLoginDelayCleared:
          recoveryDatabaseFacts.failedLoginAttempts === null &&
          recoveryDatabaseFacts.failedLoginUntil === null,
        implementerTokenRevoked:
          recoveryDatabaseFacts.activeImplementerToken === false,
        machineAccessDisabled:
          recoveryDatabaseFacts.activeImplementerToken === false,
        passwordReplaced:
          recoveryPasswordStatus.originalAuthenticated === false &&
          recoveryPasswordStatus.replacementAuthenticated === true,
      },
    },
    authenticatedHttpSmoke,
    durableWriteFailure,
    restore: {
      browserSessionsRevoked: restoredDatabaseFacts.activeBrowserSessions === 0,
      implementerTokenRevoked:
        restoredDatabaseFacts.activeImplementerToken === false,
      machineAccessDisabled:
        restoredDatabaseFacts.activeImplementerToken === false,
      newPasswordAuthenticated: restorePasswordStatus.newAuthenticated,
      postBackupFactsAbsent:
        restoredDatabaseFacts.persistedMarker === "survived",
      snapshotPasswordRejected: !restorePasswordStatus.snapshotAuthenticated,
      snapshotEraFactsPreserved:
        restoredDatabaseFacts.persistedMarker === "survived",
      status: "restored",
    },
    backup: backupFacts,
    database: {
      ...restoredDatabaseFacts,
      installationKeyVerifier: undefined,
      operatorPasswordVerifier: undefined,
      persistedMarker: undefined,
    },
  };
}

/**
 * @param {{configuration: ComposeConfiguration, fixture: PackageFixture}} proof
 */
export function proveComposeService({ configuration, fixture }) {
  const { environment, fixtureDirectory, serviceName } = fixture;
  fixture.runDocker([
    "run",
    "--rm",
    "-v",
    `${fixtureDirectory}:/fixture`,
    serviceFixtureImage,
    "chown",
    "10001:10001",
    "/fixture/config.env",
    "/fixture/quality-bar-master-key",
  ]);
  fixture.runDocker([
    "run",
    "--rm",
    "-v",
    `${fixtureDirectory}:/fixture`,
    serviceFixtureImage,
    "chmod",
    "0400",
    "/fixture/config.env",
    "/fixture/quality-bar-master-key",
  ]);
  fixture.runCompose(["build"]);
  fixture.runCompose(["up", "--detach", "--wait"]);

  const imagePlatform = fixture.runDocker([
    "image",
    "inspect",
    `${fixture.imageRepository}:${fixture.applicationVersion}`,
    "--format",
    "{{.Os}}/{{.Architecture}}",
  ]);
  assert.equal(imagePlatform, "linux/amd64");
  const uid = Number(
    fixture.runCompose(["exec", "-T", serviceName, "id", "-u"]),
  );
  assert.equal(uid, 10001);
  const processArguments = fixture
    .runCompose(["exec", "-T", serviceName, "cat", "/proc/1/cmdline"])
    .split("\u0000")
    .filter(Boolean);
  assert.equal(processArguments[0], "node");
  assert.equal(processArguments.at(-1), "src/main.js");

  const filesystemFacts = /** @type {FilesystemFacts} */ (
    jsonPackageProbe(fixture, "filesystem-facts.mjs")
  );
  assertFilesystemFacts(filesystemFacts);
  const httpFacts = /** @type {HttpFacts} */ (
    jsonPackageProbe(fixture, "http-facts.mjs", [
      environment.QUALITY_BAR_HTTP_PORT,
    ])
  );
  assert.deepEqual(httpFacts.liveness, {
    body: { status: "live" },
    status: 200,
  });
  assert.deepEqual(httpFacts.readiness, {
    body: { status: "ready" },
    status: 200,
  });
  assert.deepEqual(httpFacts.directSystem, {
    errorCode: "proxy_forwarded_required",
    status: 400,
  });
  assert.deepEqual(httpFacts.forwardedSystem, {
    errorCode: "authentication_required",
    status: 401,
  });
  const toolVersions = proveBundledTools({ fixture, serviceName });

  const initialDatabaseFacts = /** @type {DatabaseFacts} */ (
    jsonPackageProbe(fixture, "database-facts.mjs")
  );
  assert.equal(initialDatabaseFacts.persistedMarker, null);
  assert.match(initialDatabaseFacts.installationKeyVerifier, /^v1\./);
  assert.equal(initialDatabaseFacts.operatorPasswordVerifier, null);
  runPackageProbe(fixture, "write-database-marker.mjs");

  const bootstrapPassword = "a package supplied operator password";
  const gracefulShutdown = proveGracefulShutdown({
    configuration,
    fixture,
    serviceName,
  });
  assert.equal(
    fixture.runCompose(
      [
        "run",
        "--rm",
        "--no-deps",
        "-T",
        serviceName,
        "node",
        "src/bootstrap-operator-password.js",
      ],
      `${bootstrapPassword}\n`,
    ),
    '{"status":"operator_password_bootstrapped"}',
  );
  assert.throws(
    () =>
      fixture.runCompose(
        [
          "run",
          "--rm",
          "--no-deps",
          "-T",
          serviceName,
          "node",
          "src/bootstrap-operator-password.js",
        ],
        "a different package supplied password\n",
      ),
    /operator_password_already_set/,
  );
  fixture.runCompose(["up", "--detach", "--wait", "--force-recreate"]);

  const recreatedDatabaseFacts = /** @type {DatabaseFacts} */ (
    jsonPackageProbe(fixture, "database-facts.mjs")
  );
  const backupFacts = /** @type {BackupFacts} */ (
    jsonPackageProbe(fixture, "backup-facts.mjs", [fixture.masterKey])
  );
  assert.equal(recreatedDatabaseFacts.persistedMarker, "survived");
  if (recreatedDatabaseFacts.operatorPasswordVerifier === null) {
    throw new Error("package_operator_password_verifier_missing");
  }
  assert.match(recreatedDatabaseFacts.operatorPasswordVerifier, /^scrypt-v1\./);
  assert.doesNotMatch(
    recreatedDatabaseFacts.operatorPasswordVerifier,
    new RegExp(bootstrapPassword),
  );
  const initialAuthenticatedHttpSmoke = /** @type {AuthenticatedHttpSmoke} */ (
    jsonPackageProbe(
      fixture,
      "authenticated-http-smoke.mjs",
      [environment.QUALITY_BAR_HTTP_PORT, "machine"],
      bootstrapPassword,
    )
  );
  assert.match(
    initialAuthenticatedHttpSmoke.codexCapabilityCatalogVersion,
    /^\d+\.\d+\.\d+$/,
  );
  assert.deepEqual(initialAuthenticatedHttpSmoke, {
    browserStatus: 200,
    codexCapabilityCatalogVersion:
      initialAuthenticatedHttpSmoke.codexCapabilityCatalogVersion,
    hasCodexCapabilityModels: true,
    hasNavigation: true,
    loginStatus: 204,
    mcpRepositoryCount: 0,
    mcpStatus: 200,
    mcpTool: "quality_bar.list_repositories",
    openapiStatus: 200,
    openapiVersion: "3.1.0",
    repositoryCount: 0,
    repositoryListStatus: 200,
    storage: {
      filesystems: [
        {
          available_bytes:
            initialAuthenticatedHttpSmoke.storage.filesystems[0]
              .available_bytes,
          filesystem: "state",
          path: "/var/lib/quality-bar",
          status: "available",
        },
        {
          available_bytes:
            initialAuthenticatedHttpSmoke.storage.filesystems[1]
              .available_bytes,
          filesystem: "checkouts",
          path: "/var/cache/quality-bar/checkouts",
          status: "available",
        },
      ],
      reserve_bytes: 5 * 1024 ** 3,
      status: "available",
      cleanup: initialAuthenticatedHttpSmoke.storage.cleanup,
    },
    tokenStatus: 201,
  });
  proveOwnedArtifactCleanup({ fixture, serviceName });
  proveRetention({ fixture, serviceName });
  const { recoveryDatabaseFacts, recoveryPassword, recoveryPasswordStatus } =
    proveOperatorAuthorityRecovery({
      fixture,
      originalPassword: bootstrapPassword,
      port: environment.QUALITY_BAR_HTTP_PORT,
      serviceName,
    });
  const { restoredDatabaseFacts, restorePassword, restorePasswordStatus } =
    provePackageOfflineRestore({
      fixture,
      recoveryPassword,
      schemaVersion: recreatedDatabaseFacts.schemaVersion,
    });
  const durableWriteFailure = /** @type {DurableWriteFailureFacts} */ (
    jsonPackageProbe(
      fixture,
      "durable-write-failure.mjs",
      [environment.QUALITY_BAR_HTTP_PORT],
      restorePassword,
    )
  );
  for (const surface of [
    durableWriteFailure.failedWrite,
    durableWriteFailure.browser,
    durableWriteFailure.browserAsset,
    durableWriteFailure.api,
    durableWriteFailure.mcp,
  ]) {
    assert.deepEqual(surface, {
      errorCode: "storage_unavailable",
      status: 503,
    });
  }
  assert.deepEqual(durableWriteFailure.liveness, {
    body: { status: "live" },
    status: 200,
  });
  assert.deepEqual(durableWriteFailure.readiness, {
    body: { error: "storage_unavailable", status: "not_ready" },
    status: 503,
  });
  fixture.runCompose(["up", "--detach", "--wait", "--force-recreate"]);
  const repairedHttpFacts = /** @type {HttpFacts} */ (
    jsonPackageProbe(fixture, "http-facts.mjs", [
      environment.QUALITY_BAR_HTTP_PORT,
    ])
  );
  assert.deepEqual(repairedHttpFacts.readiness, {
    body: { status: "ready" },
    status: 200,
  });
  const installationDeletion = proveInstallationDeletion({
    fixture,
    serviceName,
  });

  const facts = packageFacts({
    authenticatedHttpSmoke: initialAuthenticatedHttpSmoke,
    backupFacts,
    configuration,
    durableWriteFailure,
    fixture,
    filesystemFacts,
    gracefulShutdown,
    httpFacts,
    imagePlatform,
    installationDeletion,
    processArguments,
    recoveryDatabaseFacts: /** @type {DatabaseFacts} */ (recoveryDatabaseFacts),
    recoveryPasswordStatus,
    restoredDatabaseFacts,
    restorePasswordStatus,
    toolVersions,
    uid,
  });
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(fixture.masterKey));
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(bootstrapPassword));
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(recoveryPassword));
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(restorePassword));
  // The allowlisted evidence was checked against every package-proof secret.
  // codeql[js/clear-text-logging]
  console.log(`QUALITY_BAR_PACKAGE_FACTS ${JSON.stringify(facts)}`);
}
