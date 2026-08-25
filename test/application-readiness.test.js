import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { createApplication } from "../src/application/application.js";
import { CODEX_CAPABILITY_CATALOG } from "../src/codex/codex-capabilities.js";
import { loadInstallationConfiguration } from "../src/installation-configuration.js";
import { acquireInstallationLock } from "../src/installation-environment.js";
import { bootstrapOperatorPassword } from "../src/operator/operator-password.js";
import {
  expectedSystemApplication,
  expectedSystemBackup,
  expectedSystemDurableCore,
} from "./system-storage-expected.js";

/** @typedef {ReturnType<typeof createApplication>} Application */
/** @type {Application[]} */
const applications = [];
/** @type {string[]} */
const temporaryDirectories = [];

function validInstallation() {
  return {
    externalOrigin: "http://127.0.0.1:3000",
    freeSpaceReserveBytes: 5 * 1024 ** 3,
    masterKey: Buffer.alloc(32, 7),
    trustedProxyAddresses: [],
  };
}

/** @returns {ReturnType<typeof import("../src/storage-reserve.js").createStorageReserveGate>} */
function availableStorageReserve() {
  const facts = {
    filesystems: [
      {
        available_bytes: 8 * 1024 ** 3,
        filesystem: "state",
        path: "/var/lib/quality-bar",
        status: "available",
      },
      {
        available_bytes: 7 * 1024 ** 3,
        filesystem: "checkouts",
        path: "/var/cache/quality-bar/checkouts",
        status: "available",
      },
    ],
    reserve_bytes: 5 * 1024 ** 3,
    status: "available",
  };
  const cleanupFacts = {
    artifacts_removed: 0,
    error: null,
    last_run_at: "2026-08-02T12:00:00.000Z",
    sessions_removed: 0,
    status: "available",
  };
  return /** @type {any} */ ({
    assertCodexStartAvailable: () => facts,
    assertPollingObservationAdvanceAvailable: () => facts,
    cleanupEligibleData() {},
    preparePollingObservationAdvance: () => facts,
    assertWorkAdmissionAvailable: () => facts,
    readCleanupFacts: () => cleanupFacts,
    readFacts: () => ({ ...facts, cleanup: cleanupFacts }),
  });
}

/**
 * @param {string} databasePath
 * @param {Partial<Parameters<typeof createApplication>[0]>} [options]
 */
async function startApplication(databasePath, options = {}) {
  const application = createApplication({
    applicationVersion: "1.2.3",
    backupsPath: options.backupsPath ?? join(dirname(databasePath), "backups"),
    databasePath,
    createStorageReserve:
      options.createStorageReserve ?? availableStorageReserve,
    loadInstallation: options.loadInstallation ?? validInstallation,
    validateInstallation:
      options.validateInstallation ??
      (() => ({ releaseInstallationLock() {} })),
    validateSources: options.validateSources ?? (() => {}),
    validateTools: options.validateTools ?? (() => {}),
    validateCodexAuthentication:
      options.validateCodexAuthentication ?? (() => {}),
    createCodexRuntime: options.createCodexRuntime,
    writeLog: options.writeLog ?? (() => {}),
  });
  await application.server.listen({ host: "127.0.0.1", port: 0 });
  const address = application.server.server.address();
  if (!address || typeof address === "string") {
    throw new Error("application_readiness_address_unavailable");
  }
  applications.push(application);
  return {
    application,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

/** @param {Response} response */
async function responseErrorCode(response) {
  const body = /** @type {{error: {code: string}}} */ (await response.json());
  return body.error.code;
}

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-application-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

afterEach(async () => {
  for (const application of applications.splice(0)) {
    await application.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the ready application starts and closes its composed Codex runtime", async () => {
  let started = 0;
  let closed = 0;
  let composed = false;
  const { application } = await startApplication(temporaryDatabasePath(), {
    createCodexRuntime(durableCore, dependencies) {
      assert.equal(durableCore?.get instanceof Function, true);
      assert.equal(dependencies.ioPool?.run instanceof Function, true);
      assert.equal(
        dependencies.repositories?.acquireGitCredential instanceof Function,
        true,
      );
      composed = true;
      return {
        async close() {
          closed += 1;
        },
        start() {
          started += 1;
        },
      };
    },
  });
  assert.equal(composed, true);
  assert.equal(started, 1);
  await application.close();
  applications.splice(applications.indexOf(application), 1);
  assert.equal(closed, 1);
});

test("a startup failure releases the SQLite installation lock before propagating", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-application-startup-lock-"),
  );
  const lockPath = join(directory, "installation.lock");
  const createLock = () => new DatabaseSync(lockPath);
  try {
    assert.throws(
      () =>
        createApplication({
          databasePath: join(directory, "quality-bar.sqlite3"),
          loadInstallation: validInstallation,
          validateCodexAuthentication() {},
          validateInstallation: () => ({
            releaseInstallationLock: acquireInstallationLock(createLock),
          }),
          validateSources() {},
          validateTools() {},
          createStorageReserve() {
            throw Object.assign(new Error("storage reserve unavailable"), {
              code: "storage_reserve_unavailable",
            });
          },
          writeLog() {},
        }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "storage_reserve_unavailable",
    );
    const releaseInstallationLock = acquireInstallationLock(createLock);
    releaseInstallationLock();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("startup fails fast when SQLite cannot open the durable core", () => {
  assert.throws(
    () =>
      createApplication({
        applicationVersion: "1.2.3",
        backupsPath: join(tmpdir(), "quality-bar-fail-fast-backups"),
        databasePath: ":memory:",
        createStorageReserve: availableStorageReserve,
        loadInstallation: validInstallation,
        validateInstallation: () => ({ releaseInstallationLock() {} }),
        validateSources() {},
        validateTools() {},
        validateCodexAuthentication() {},
        writeLog() {},
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string",
  );
});

test("liveness remains a process probe when the configured browser origin requires HTTPS", async () => {
  const { origin } = await startApplication(temporaryDatabasePath(), {
    loadInstallation: () => ({
      externalOrigin: "https://quality-bar.example",
      freeSpaceReserveBytes: 5 * 1024 ** 3,
      masterKey: Buffer.alloc(32, 7),
      trustedProxyAddresses: ["127.0.0.1"],
    }),
  });

  const liveResponse = await fetch(`${origin}/health/live`);
  assert.equal(liveResponse.status, 200);
  assert.deepEqual(await liveResponse.json(), { status: "live" });

  const directProductResponse = await fetch(`${origin}/api/v1/system`);
  assert.equal(directProductResponse.status, 400);
  assert.equal(
    await responseErrorCode(directProductResponse),
    "proxy_forwarded_required",
  );
});

test("startup fails fast on a configuration failure and logs the exact code", () => {
  /** @type {string[]} */
  const logs = [];
  const configurationFailure = Object.assign(
    new Error("Configuration has an unknown key"),
    { code: "configuration_unknown" },
  );
  assert.throws(
    () =>
      createApplication({
        applicationVersion: "1.2.3",
        backupsPath: join(tmpdir(), "quality-bar-configuration-backups"),
        databasePath: temporaryDatabasePath(),
        createStorageReserve: availableStorageReserve,
        loadInstallation() {
          throw configurationFailure;
        },
        validateInstallation: () => ({ releaseInstallationLock() {} }),
        validateSources() {},
        validateTools() {},
        validateCodexAuthentication() {},
        writeLog(line) {
          logs.push(line);
        },
      }),
    (error) => error === configurationFailure,
  );
  assert.match(logs.join(""), /"error":"configuration_unknown"/);
});

test("unsafe fixed sources are rejected before their contents are read", () => {
  let wasRead = false;
  const sourceFailure = Object.assign(new Error("unsafe source"), {
    code: "owned_path_unsafe",
  });
  assert.throws(
    () =>
      createApplication({
        databasePath: temporaryDatabasePath(),
        loadInstallation() {
          wasRead = true;
          return validInstallation();
        },
        validateSources() {
          throw sourceFailure;
        },
        writeLog() {},
      }),
    (error) => error === sourceFailure,
  );
  assert.equal(wasRead, false);
});

test("unavailable Codex authentication leaves the durable System surface ready", async () => {
  const authenticationFailure = Object.assign(new Error("not logged in"), {
    code: "codex_authentication_unavailable",
  });
  const { application, origin } = await startApplication(
    temporaryDatabasePath(),
    {
      validateCodexAuthentication() {
        throw authenticationFailure;
      },
    },
  );

  const readyResponse = await fetch(`${origin}/health/ready`);
  assert.equal(readyResponse.status, 200);
  assert.deepEqual(await readyResponse.json(), { status: "ready" });
  assert.deepEqual(application.codexCapability, {
    error: "codex_authentication_unavailable",
    status: "unavailable",
  });

  assert.ok(application.durableCore);
  bootstrapOperatorPassword(
    application.durableCore,
    "a correct operator password",
  );
  const loginResponse = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const setCookie = loginResponse.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("application_readiness_cookie_missing");
  }
  const cookie = setCookie.split(";", 1)[0];

  const systemResponse = await fetch(`${origin}/api/v1/system`, {
    headers: { cookie },
  });
  assert.equal(systemResponse.status, 200);
  const system = /** @type {any} */ (await systemResponse.json());
  assert.deepEqual(system, {
    application: expectedSystemApplication,
    backup: expectedSystemBackup,
    bootstrap: { status: "complete" },
    browser_sessions: { active_count: 1, status: "available" },
    codex: {
      catalog: CODEX_CAPABILITY_CATALOG,
      error: "codex_authentication_unavailable",
      status: "unavailable",
    },
    execution_providers: [
      {
        error: {
          code: "codex_authentication_unavailable",
          message: "Codex is not signed in for this Quality Bar installation.",
          recovery:
            "Run `docker compose run --rm --no-deps quality-bar codex login --device-auth` from the Quality Bar installation directory, then restart Quality Bar.",
        },
        id: "codex",
        name: "Codex",
        status: "unavailable",
      },
    ],
    codex_execution: {
      concurrency: {
        maximum_running: 1,
        running_count: 0,
        start_gate: "available",
      },
      failures: [],
      queue: { count: 0, rows: [] },
      running: { count: 0, rows: [] },
    },
    delivery: { surfaces: [] },
    durable_core: expectedSystemDurableCore(system.durable_core),
    implementer_token: {
      status: "revoked",
    },
    polling: { connections: [] },
    storage: availableStorageReserve().readFacts(),
  });
});

test("a malformed external master key never appears in logs on startup failure", () => {
  /** @type {string[]} */
  const logs = [];
  const secretValue = "this-master-key-must-never-appear";
  assert.throws(
    () =>
      createApplication({
        applicationVersion: "1.2.3",
        backupsPath: join(tmpdir(), "quality-bar-master-key-backups"),
        databasePath: temporaryDatabasePath(),
        createStorageReserve: availableStorageReserve,
        loadInstallation() {
          return loadInstallationConfiguration({
            configPath: "/etc/quality-bar/config.env",
            masterKeyPath: "/run/secrets/quality-bar-master-key",
            readFile(path, encoding) {
              if (path === "/etc/quality-bar/config.env") {
                return encoding
                  ? [
                      "QUALITY_BAR_EXTERNAL_ORIGIN=http://127.0.0.1:3000",
                      "QUALITY_BAR_TRUSTED_PROXY_ADDRESSES=none",
                    ].join("\n")
                  : Buffer.from("");
              }
              if (path === "/run/secrets/quality-bar-master-key") {
                return encoding ? secretValue : Buffer.from(secretValue);
              }
              throw new Error("unexpected path");
            },
          });
        },
        validateInstallation: () => ({ releaseInstallationLock() {} }),
        validateSources() {},
        validateTools() {},
        validateCodexAuthentication() {},
        writeLog(line) {
          logs.push(line);
        },
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "master_key_malformed",
  );
  assert.match(logs.join(""), /"error":"master_key_malformed"/);
  assert.doesNotMatch(logs.join(""), new RegExp(secretValue));
});

test("an undecryptable installation key fails startup fast", async () => {
  const databasePath = temporaryDatabasePath();
  const first = await startApplication(databasePath);
  await first.application.close();
  applications.splice(applications.indexOf(first.application), 1);

  assert.throws(
    () =>
      createApplication({
        applicationVersion: "1.2.3",
        backupsPath: join(tmpdir(), "quality-bar-undecryptable-backups"),
        databasePath,
        createStorageReserve: availableStorageReserve,
        loadInstallation() {
          return {
            externalOrigin: "http://127.0.0.1:3000",
            freeSpaceReserveBytes: 5 * 1024 ** 3,
            masterKey: Buffer.alloc(32, 8),
            trustedProxyAddresses: [],
          };
        },
        validateInstallation: () => ({ releaseInstallationLock() {} }),
        validateSources() {},
        validateTools() {},
        validateCodexAuthentication() {},
        writeLog() {},
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "master_key_undecryptable",
  );
});
