import assert from "node:assert/strict";

import { runPackageProbe } from "./package-probes.mjs";

const serviceFixtureImage =
  "node:24.18.0-alpine@sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc";

function jsonProbe(fixture, name, arguments_, input) {
  return JSON.parse(runPackageProbe(fixture, name, arguments_, input));
}

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

function packageFacts({
  authenticatedHttpSmoke,
  configuration,
  fixture,
  filesystemFacts,
  httpFacts,
  imagePlatform,
  processArguments,
  recreatedDatabaseFacts,
  toolVersions,
  uid,
}) {
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
      freeSpaceReserveBytes: 5 * 1024 ** 3,
      freeSpaceReserveMet:
        filesystemFacts.stateFreeBytes >= 5 * 1024 ** 3 &&
        filesystemFacts.checkoutsFreeBytes >= 5 * 1024 ** 3,
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
    },
    authenticatedHttpSmoke,
    database: {
      ...recreatedDatabaseFacts,
      installationKeyVerifier: undefined,
      operatorPasswordVerifier: undefined,
      persistedMarker: undefined,
    },
  };
}

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
    `quality-bar:${fixture.applicationVersion}`,
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

  const filesystemFacts = jsonProbe(fixture, "filesystem-facts.mjs");
  assertFilesystemFacts(filesystemFacts);
  const httpFacts = jsonProbe(fixture, "http-facts.mjs", [
    environment.QUALITY_BAR_HTTP_PORT,
  ]);
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

  const initialDatabaseFacts = jsonProbe(fixture, "database-facts.mjs");
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

  const recreatedDatabaseFacts = jsonProbe(fixture, "database-facts.mjs");
  assert.equal(recreatedDatabaseFacts.persistedMarker, "survived");
  assert.match(recreatedDatabaseFacts.operatorPasswordVerifier, /^scrypt-v1\./);
  assert.doesNotMatch(
    recreatedDatabaseFacts.operatorPasswordVerifier,
    new RegExp(bootstrapPassword),
  );
  const authenticatedHttpSmoke = jsonProbe(
    fixture,
    "authenticated-http-smoke.mjs",
    [environment.QUALITY_BAR_HTTP_PORT],
    bootstrapPassword,
  );
  assert.match(
    authenticatedHttpSmoke.codexCapabilityCatalogVersion,
    /^\d+\.\d+\.\d+$/,
  );
  assert.deepEqual(authenticatedHttpSmoke, {
    browserStatus: 200,
    codexCapabilityCatalogVersion:
      authenticatedHttpSmoke.codexCapabilityCatalogVersion,
    hasCodexCapabilityModels: true,
    hasNavigation: true,
    loginStatus: 204,
    openapiStatus: 200,
    openapiVersion: "3.1.0",
  });

  const facts = packageFacts({
    authenticatedHttpSmoke,
    configuration,
    fixture,
    filesystemFacts,
    httpFacts,
    imagePlatform,
    processArguments,
    recreatedDatabaseFacts,
    toolVersions,
    uid,
  });
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(fixture.masterKey));
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(bootstrapPassword));
  console.log(`QUALITY_BAR_PACKAGE_FACTS ${JSON.stringify(facts)}`);
}
