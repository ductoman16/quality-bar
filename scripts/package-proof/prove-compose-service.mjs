import assert from "node:assert/strict";

import { proveOperatorAuthorityRecovery } from "./operator-authority-recovery.mjs";
import { runPackageProbe } from "./package-probes.mjs";

const serviceFixtureImage =
  "node:24.18.0-alpine@sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc";

/** @typedef {import("./package-fixture.mjs").PackageFixture} PackageFixture */
/** @typedef {import("./compose-configuration.mjs").ComposeConfiguration} ComposeConfiguration */
/**
 * @typedef {{
 *   localFilesystems: boolean,
 *   stateFreeBytes: number,
 *   checkoutsFreeBytes: number,
 *   pathFacts: Record<string, {gid: number, mode: number, uid: number}>,
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

/**
 * @param {PackageFixture} fixture
 * @param {string} name
 * @param {string[]} [arguments_]
 * @param {string} [input]
 * @returns {unknown}
 */
function jsonProbe(fixture, name, arguments_, input) {
  return JSON.parse(runPackageProbe(fixture, name, arguments_, input));
}

/** @param {FilesystemFacts} filesystemFacts */
function assertFilesystemFacts(filesystemFacts) {
  assert.equal(filesystemFacts.localFilesystems, true);
  assert.ok(filesystemFacts.stateFreeBytes >= 5 * 1024 ** 3);
  assert.ok(filesystemFacts.checkoutsFreeBytes >= 5 * 1024 ** 3);
  for (const [path, facts] of Object.entries(filesystemFacts.pathFacts)) {
    assert.deepEqual(facts, {
      gid: 10001,
      mode:
        path === "/etc/quality-bar/config.env" ||
        path === "/run/secrets/quality-bar-master-key"
          ? 0o400
          : 0o700,
      uid: 10001,
    });
  }
}

/**
 * @param {{
 *   authenticatedHttpSmoke: AuthenticatedHttpSmoke,
 *   backupFacts: BackupFacts,
 *   configuration: ComposeConfiguration,
 *   fixture: PackageFixture,
 *   filesystemFacts: FilesystemFacts,
 *   httpFacts: HttpFacts,
 *   imagePlatform: string,
 *   processArguments: string[],
 *   recoveryDatabaseFacts: DatabaseFacts,
 *   recoveryPasswordStatus: {
 *     originalAuthenticated: boolean,
 *     replacementAuthenticated: boolean,
 *   },
 *   recreatedDatabaseFacts: DatabaseFacts,
 *   toolVersions: {codex: string, git: string},
 *   uid: number,
 * }} facts
 */
function packageFacts({
  authenticatedHttpSmoke,
  backupFacts,
  configuration,
  fixture,
  filesystemFacts,
  httpFacts,
  imagePlatform,
  processArguments,
  recoveryDatabaseFacts,
  recoveryPasswordStatus,
  recreatedDatabaseFacts,
  toolVersions,
  uid,
}) {
  if (recreatedDatabaseFacts.operatorPasswordVerifier === null) {
    throw new Error("package_operator_password_verifier_missing");
  }
  const serviceVolumes = configuration.services[fixture.serviceName].volumes;
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
      ownedPaths: Object.values(filesystemFacts.pathFacts).every(
        (facts) => facts.gid === 10001 && facts.uid === 10001,
      ),
      persistedAcrossRecreate: true,
      volumeTarget: serviceVolumes[0].target,
    },
    installation: {
      freeSpaceReserveBytes: authenticatedHttpSmoke.storage.reserve_bytes,
      freeSpaceReserveMet:
        authenticatedHttpSmoke.storage.status === "available",
    },
    network: {
      httpBindAddress: "127.0.0.1",
      mode: configuration.services[fixture.serviceName].network_mode,
    },
    tools: { ...toolVersions, persistentCodexLogin: false },
    configuration: {
      configPath: "/etc/quality-bar/config.env",
      encryptedVerifier: /^v1\./.test(
        recreatedDatabaseFacts.installationKeyVerifier,
      ),
      masterKeyPath: "/run/secrets/quality-bar-master-key",
    },
    authority: {
      operatorPasswordBootstrap: /^scrypt-v1\./.test(
        recreatedDatabaseFacts.operatorPasswordVerifier,
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
    restore: {
      postBackupFactsAbsent:
        recreatedDatabaseFacts.persistedMarker === "survived",
      snapshotPasswordAuthenticated: authenticatedHttpSmoke.loginStatus === 204,
      snapshotEraFactsPreserved:
        recreatedDatabaseFacts.persistedMarker === "survived",
      status: "restored",
    },
    backup: backupFacts,
    database: {
      ...recreatedDatabaseFacts,
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
    jsonProbe(fixture, "filesystem-facts.mjs")
  );
  assertFilesystemFacts(filesystemFacts);
  const httpFacts = /** @type {HttpFacts} */ (
    jsonProbe(fixture, "http-facts.mjs", [environment.QUALITY_BAR_HTTP_PORT])
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
  const toolVersions = {
    codex: fixture
      .runCompose(["exec", "-T", serviceName, "codex", "--version"])
      .replace("codex-cli ", ""),
    git: fixture
      .runCompose(["exec", "-T", serviceName, "git", "--version"])
      .replace("git version ", ""),
  };
  assert.equal(toolVersions.git, "2.54.0");
  assert.equal(toolVersions.codex, "0.145.0");

  const initialDatabaseFacts = /** @type {DatabaseFacts} */ (
    jsonProbe(fixture, "database-facts.mjs")
  );
  assert.equal(initialDatabaseFacts.persistedMarker, null);
  assert.match(initialDatabaseFacts.installationKeyVerifier, /^v1\./);
  assert.equal(initialDatabaseFacts.operatorPasswordVerifier, null);
  runPackageProbe(fixture, "write-database-marker.mjs");

  const bootstrapPassword = "a package supplied operator password";
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
    jsonProbe(fixture, "database-facts.mjs")
  );
  const backupFacts = /** @type {BackupFacts} */ (
    jsonProbe(fixture, "backup-facts.mjs", [fixture.masterKey])
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
    jsonProbe(
      fixture,
      "authenticated-http-smoke.mjs",
      [environment.QUALITY_BAR_HTTP_PORT],
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
    openapiStatus: 200,
    openapiVersion: "3.1.0",
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
    },
  });
  const { recoveryDatabaseFacts, recoveryPassword, recoveryPasswordStatus } =
    proveOperatorAuthorityRecovery({
      fixture,
      originalPassword: bootstrapPassword,
      port: environment.QUALITY_BAR_HTTP_PORT,
      serviceName,
    });
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
  fixture.runCompose(["stop", serviceName]);
  assert.equal(
    fixture.runCompose([
      "run",
      "--rm",
      "--no-deps",
      "-T",
      serviceName,
      "node",
      "src/restore-backup.js",
      restoreSnapshot.manifestPath,
    ]),
    `{"applicationVersion":"${fixture.applicationVersion}","schemaVersion":${recreatedDatabaseFacts.schemaVersion},"status":"restored"}`,
  );
  fixture.runCompose(["up", "--detach", "--wait", "--force-recreate"]);
  const restoredDatabaseFacts = /** @type {DatabaseFacts} */ (
    jsonProbe(fixture, "database-facts.mjs")
  );
  assert.equal(restoredDatabaseFacts.persistedMarker, "survived");
  const authenticatedHttpSmoke = /** @type {AuthenticatedHttpSmoke} */ (
    jsonProbe(
      fixture,
      "authenticated-http-smoke.mjs",
      [environment.QUALITY_BAR_HTTP_PORT],
      recoveryPassword,
    )
  );
  assert.equal(authenticatedHttpSmoke.loginStatus, 204);

  const facts = packageFacts({
    authenticatedHttpSmoke,
    backupFacts,
    configuration,
    fixture,
    filesystemFacts,
    httpFacts,
    imagePlatform,
    processArguments,
    recoveryDatabaseFacts: /** @type {DatabaseFacts} */ (recoveryDatabaseFacts),
    recoveryPasswordStatus,
    recreatedDatabaseFacts: restoredDatabaseFacts,
    toolVersions,
    uid,
  });
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(fixture.masterKey));
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(bootstrapPassword));
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(recoveryPassword));
  console.log(`QUALITY_BAR_PACKAGE_FACTS ${JSON.stringify(facts)}`);
}
