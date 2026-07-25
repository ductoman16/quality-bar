import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const applicationVersion = readFileSync(".env", "utf8").match(
  /^QUALITY_BAR_VERSION=(\d+\.\d+\.\d+)$/m,
)?.[1];
assert.ok(applicationVersion, ".env must define a semantic QUALITY_BAR_VERSION");
const serviceName = "quality-bar";
const projectName = `quality-bar-package-${process.pid}`;
const fixtureDirectory = mkdtempSync(join(tmpdir(), "quality-bar-package-"));
const configurationPath = join(fixtureDirectory, "config.env");
const masterKeyPath = join(fixtureDirectory, "quality-bar-master-key");
const masterKey = Buffer.alloc(32, 7).toString("base64");
writeFileSync(
  configurationPath,
  [
    "QUALITY_BAR_EXTERNAL_ORIGIN=http://127.0.0.1:3000",
    "QUALITY_BAR_TRUSTED_PROXY_ADDRESSES=none",
  ].join("\n"),
);
writeFileSync(masterKeyPath, masterKey);

function run(command, arguments_, environment = {}, input) {
  return execFileSync(command, arguments_, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...environment },
    input,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

test("Compose boots with one strict configuration source and external installation master key", async () => {
  const hostPort = await reservePort();
  const environment = {
    COMPOSE_PROJECT_NAME: projectName,
    QUALITY_BAR_HTTP_PORT: String(hostPort),
    QUALITY_BAR_VERSION: applicationVersion,
    QUALITY_BAR_CONFIG_FILE: configurationPath,
    QUALITY_BAR_MASTER_KEY_FILE: masterKeyPath,
  };

  const configuration = JSON.parse(
    run("docker", ["compose", "config", "--format", "json"], environment),
  );
  assert.deepEqual(Object.keys(configuration.services), [serviceName]);
  assert.equal(configuration.services[serviceName].platform, "linux/amd64");
  assert.equal(
    configuration.services[serviceName].image,
    `quality-bar:${applicationVersion}`,
  );
  assert.equal(configuration.services[serviceName].profiles, undefined);
  assert.equal(configuration.services[serviceName].depends_on, undefined);
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
      run(
        "docker",
        [
          "build",
          "--platform",
          "linux/amd64",
          "--output",
          "type=cacheonly",
          ".",
        ],
        environment,
      ),
    /QUALITY_BAR_VERSION must be a semantic version/,
  );

  let primaryFailure;
  try {
    run(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${fixtureDirectory}:/fixture`,
        "node:24.18.0-alpine@sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc",
        "sh",
        "-c",
        "chown 10001:10001 /fixture/config.env /fixture/quality-bar-master-key && chmod 0400 /fixture/config.env /fixture/quality-bar-master-key",
      ],
      environment,
    );
    run("docker", ["compose", "build"], environment);
    run("docker", ["compose", "up", "--detach", "--wait"], environment);

    const imagePlatform = run("docker", [
      "image",
      "inspect",
      `quality-bar:${applicationVersion}`,
      "--format",
      "{{.Os}}/{{.Architecture}}",
    ]);
    assert.equal(imagePlatform, "linux/amd64");
    const uidOutput = run(
      "docker",
      ["compose", "exec", "-T", serviceName, "id", "-u"],
      environment,
    );
    assert.equal(uidOutput, "10001");
    const uid = Number(uidOutput);
    const processArguments = run(
      "docker",
      ["compose", "exec", "-T", serviceName, "cat", "/proc/1/cmdline"],
      environment,
    )
      .split("\u0000")
      .filter(Boolean);
    assert.equal(processArguments[0], "node");
    assert.equal(processArguments.at(-1), "src/main.js");
    const filesystemFacts = JSON.parse(
      run(
        "docker",
        [
          "compose",
          "exec",
          "-T",
          serviceName,
          "node",
          "--input-type=module",
          "--eval",
          `
            import { lstatSync, statfsSync } from "node:fs";
            const paths = [
              "/var/lib/quality-bar",
              "/var/lib/quality-bar/codex-home",
              "/var/cache/quality-bar/checkouts",
              "/var/backups/quality-bar",
              "/etc/quality-bar/config.env",
              "/run/secrets/quality-bar-master-key",
            ];
            const pathFacts = Object.fromEntries(paths.map((path) => {
              const status = lstatSync(path);
              return [path, { gid: status.gid, mode: status.mode & 0o777, uid: status.uid }];
            }));
            const localFilesystemTypes = new Set([0xef53, 0x58465342, 0x794c7630, 0x9123683e, 0x2fc12fc1]);
            const localFilesystems = [
              "/var/lib/quality-bar",
              "/var/cache/quality-bar/checkouts",
              "/var/backups/quality-bar",
            ].every((path) => localFilesystemTypes.has(statfsSync(path).type));
            console.log(JSON.stringify({
              localFilesystems,
              pathFacts,
              stateFreeBytes: statfsSync("/var/lib/quality-bar").bavail * statfsSync("/var/lib/quality-bar").bsize,
              checkoutsFreeBytes: statfsSync("/var/cache/quality-bar/checkouts").bavail * statfsSync("/var/cache/quality-bar/checkouts").bsize,
            }));
          `,
        ],
        environment,
      ),
    );
    assert.equal(filesystemFacts.localFilesystems, true);
    assert.ok(filesystemFacts.stateFreeBytes >= 5 * 1024 ** 3);
    assert.ok(filesystemFacts.checkoutsFreeBytes >= 5 * 1024 ** 3);
    for (const [path, facts] of Object.entries(filesystemFacts.pathFacts)) {
      assert.deepEqual(facts, {
        gid: 10001,
        mode: path === "/etc/quality-bar/config.env" || path === "/run/secrets/quality-bar-master-key" ? 0o400 : 0o700,
        uid: 10001,
      });
    }
    const gitVersion = run(
      "docker",
      ["compose", "exec", "-T", serviceName, "git", "--version"],
      environment,
    ).replace("git version ", "");
    const codexVersion = run(
      "docker",
      ["compose", "exec", "-T", serviceName, "codex", "--version"],
      environment,
    ).replace("codex-cli ", "");
    assert.equal(gitVersion, "2.54.0");
    assert.equal(codexVersion, "0.145.0");
    const response = await fetch(`http://127.0.0.1:${hostPort}/health/live`);
    assert.equal(response.status, 200);
    const liveness = await response.json();
    assert.deepEqual(liveness, { status: "live" });

    const readyResponse = await fetch(
      `http://127.0.0.1:${hostPort}/health/ready`,
    );
    assert.equal(
      readyResponse.status,
      200,
      run("docker", ["compose", "logs", "--no-color", serviceName], environment),
    );
    const readiness = await readyResponse.json();
    assert.deepEqual(readiness, { status: "ready" });
    const systemResponse = await fetch(
      `http://127.0.0.1:${hostPort}/api/v1/system`,
    );
    assert.equal(systemResponse.status, 401);
    assert.equal((await systemResponse.json()).error.code, "authentication_required");

    const inspectDatabaseScript = `
      import { DatabaseSync } from "node:sqlite";
      const database = new DatabaseSync("/var/lib/quality-bar/quality-bar.sqlite3");
      const scalar = (sql, field) => database.prepare(sql).get()[field];
      console.log(JSON.stringify({
        databaseVersion: scalar("SELECT sqlite_version() AS version", "version"),
        foreignKeys: (database.exec("PRAGMA foreign_keys = ON"), scalar("PRAGMA foreign_keys", "foreign_keys") === 1),
        integrity: scalar("PRAGMA integrity_check", "integrity_check"),
        installationKeyVerifier: database.prepare("SELECT value FROM quality_bar_metadata WHERE key = ?").get("installation_key_verifier")?.value ?? null,
        journalMode: scalar("PRAGMA journal_mode", "journal_mode"),
        operatorPasswordVerifier: database.prepare("SELECT value FROM quality_bar_metadata WHERE key = ?").get("operator_password_verifier")?.value ?? null,
        persistedMarker: database.prepare("SELECT value FROM quality_bar_metadata WHERE key = ?").get("package_persistence_test")?.value ?? null,
        schemaVersion: scalar("PRAGMA user_version", "user_version"),
        synchronous: ({ 0: "off", 1: "normal", 2: "full", 3: "extra" })[scalar("PRAGMA synchronous", "synchronous")],
      }));
      database.close();
    `;
    const initialDatabaseFacts = JSON.parse(
      run(
        "docker",
        [
          "compose",
          "exec",
          "-T",
          serviceName,
          "node",
          "--input-type=module",
          "--eval",
          inspectDatabaseScript,
        ],
        environment,
      ),
    );
    assert.equal(initialDatabaseFacts.persistedMarker, null);
    assert.match(initialDatabaseFacts.installationKeyVerifier, /^v1\./);
    assert.equal(initialDatabaseFacts.operatorPasswordVerifier, null);
    run(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        serviceName,
        "node",
        "--input-type=module",
        "--eval",
        `
          import { DatabaseSync } from "node:sqlite";
          const database = new DatabaseSync("/var/lib/quality-bar/quality-bar.sqlite3");
          database.prepare("INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)").run("package_persistence_test", "survived");
          database.close();
        `,
      ],
      environment,
    );
    const bootstrapPassword = "a package supplied operator password";
    run("docker", ["compose", "stop", serviceName], environment);
    assert.equal(
      run(
        "docker",
        [
          "compose",
          "run",
          "--rm",
          "--no-deps",
          "-T",
          serviceName,
          "node",
          "src/bootstrap-operator-password.js",
        ],
        environment,
        `${bootstrapPassword}\n`,
      ),
      '{"status":"operator_password_bootstrapped"}',
    );
    assert.throws(
      () =>
        run(
          "docker",
          [
            "compose",
            "run",
            "--rm",
            "--no-deps",
            "-T",
            serviceName,
            "node",
            "src/bootstrap-operator-password.js",
          ],
          environment,
          "a different package supplied password\n",
        ),
      /operator_password_already_set/,
    );
    run(
      "docker",
      ["compose", "up", "--detach", "--wait", "--force-recreate"],
      environment,
    );
    const recreatedDatabaseFacts = JSON.parse(
      run(
        "docker",
        [
          "compose",
          "exec",
          "-T",
          serviceName,
          "node",
          "--input-type=module",
          "--eval",
          inspectDatabaseScript,
        ],
        environment,
      ),
    );
    assert.equal(recreatedDatabaseFacts.persistedMarker, "survived");
    assert.match(recreatedDatabaseFacts.operatorPasswordVerifier, /^scrypt-v1\./);
    assert.doesNotMatch(recreatedDatabaseFacts.operatorPasswordVerifier, new RegExp(bootstrapPassword));

    const packageFacts = {
      serviceCount: Object.keys(configuration.services).length,
      companionServiceCount: 0,
      platform: imagePlatform,
      image: `quality-bar:${applicationVersion}`,
      applicationProcess: {
        uid,
        pid: 1,
        executable: processArguments[0],
        entrypoint: processArguments.at(-1),
      },
      liveness: {
        path: "/health/live",
        httpStatus: response.status,
        response: liveness,
      },
      readiness: {
        path: "/health/ready",
        httpStatus: readyResponse.status,
        response: readiness,
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
      tools: {
        codex: codexVersion,
        git: gitVersion,
        persistentCodexLogin: false,
      },
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
      database: {
        ...recreatedDatabaseFacts,
        installationKeyVerifier: undefined,
        operatorPasswordVerifier: undefined,
        persistedMarker: undefined,
      },
    };
    assert.doesNotMatch(JSON.stringify(packageFacts), new RegExp(masterKey));
    assert.doesNotMatch(JSON.stringify(packageFacts), new RegExp(bootstrapPassword));
    console.log(`QUALITY_BAR_PACKAGE_FACTS ${JSON.stringify(packageFacts)}`);
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    try {
      run(
        "docker",
        ["compose", "down", "--volumes", "--remove-orphans"],
        environment,
      );
    } catch (cleanupError) {
      if (!primaryFailure) {
        throw cleanupError;
      }
      process.stderr.write(`Package cleanup also failed: ${cleanupError.message}\n`);
    }
    rmSync(fixtureDirectory, { force: true, recursive: true });
  }
});
