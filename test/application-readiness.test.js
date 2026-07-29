import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createApplication } from "../src/application.js";
import { CODEX_CAPABILITY_CATALOG } from "../src/codex-capabilities.js";
import { loadInstallationConfiguration } from "../src/installation-configuration.js";
import { bootstrapOperatorPassword } from "../src/operator-password.js";

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
  return /** @type {any} */ ({
    assertCodexStartAvailable: () => facts,
    assertPollingObservationAdvanceAvailable: () => facts,
    preparePollingObservationAdvance: () => facts,
    assertWorkAdmissionAvailable: () => facts,
    readFacts: () => facts,
  });
}

/**
 * @param {string} databasePath
 * @param {Partial<Parameters<typeof createApplication>[0]>} [options]
 */
async function startApplication(databasePath, options = {}) {
  const application = createApplication({
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
    writeLog: options.writeLog ?? (() => {}),
  });
  await new Promise((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = application.server.address();
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

test("SQLite startup failure keeps liveness distinct from exact not-ready state", async () => {
  const { origin } = await startApplication(":memory:");

  const liveResponse = await fetch(`${origin}/health/live`);
  assert.equal(liveResponse.status, 200);
  assert.deepEqual(await liveResponse.json(), { status: "live" });

  const readyResponse = await fetch(`${origin}/health/ready`);
  assert.equal(readyResponse.status, 503);
  assert.deepEqual(await readyResponse.json(), {
    error: "wal_unavailable",
    status: "not_ready",
  });
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

test("configuration failure keeps product traffic unavailable without exposing secret values", async () => {
  /** @type {string[]} */
  const logs = [];
  const configurationFailure = Object.assign(
    new Error("Configuration has an unknown key"),
    { code: "configuration_unknown" },
  );
  const { origin } = await startApplication(temporaryDatabasePath(), {
    loadInstallation() {
      throw configurationFailure;
    },
    /** @param {string} line */
    writeLog(line) {
      logs.push(line);
    },
  });

  const liveResponse = await fetch(`${origin}/health/live`);
  assert.equal(liveResponse.status, 200);
  assert.deepEqual(await liveResponse.json(), { status: "live" });

  const readyResponse = await fetch(`${origin}/health/ready`);
  assert.equal(readyResponse.status, 503);
  assert.deepEqual(await readyResponse.json(), {
    error: "configuration_unknown",
    status: "not_ready",
  });

  const productResponse = await fetch(`${origin}/api/v1/system`);
  assert.equal(productResponse.status, 503);
  assert.equal(
    await responseErrorCode(productResponse),
    "configuration_unknown",
  );
});

test("unsafe fixed sources are rejected before their contents are read", async () => {
  let wasRead = false;
  const sourceFailure = Object.assign(new Error("unsafe source"), {
    code: "owned_path_unsafe",
  });
  const application = createApplication({
    databasePath: temporaryDatabasePath(),
    loadInstallation() {
      wasRead = true;
      return validInstallation();
    },
    validateSources() {
      throw sourceFailure;
    },
    writeLog() {},
  });
  applications.push(application);

  assert.equal(wasRead, false);
  assert.equal(application.durableCore, null);
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
  assert.deepEqual(await systemResponse.json(), {
    bootstrap: { status: "complete" },
    browser_sessions: { active_count: 1, status: "available" },
    codex: {
      catalog: CODEX_CAPABILITY_CATALOG,
      error: "codex_authentication_unavailable",
      status: "unavailable",
    },
    durable_core: { schema_version: 35, status: "ready" },
    implementer_token: {
      status: "revoked",
    },
    storage: availableStorageReserve().readFacts(),
  });
});

test("a malformed external master key never appears in responses or logs", async () => {
  /** @type {string[]} */
  const logs = [];
  const secretValue = "this-master-key-must-never-appear";
  const { origin } = await startApplication(temporaryDatabasePath(), {
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
    /** @param {string} line */
    writeLog(line) {
      logs.push(line);
    },
  });

  const readyResponse = await fetch(`${origin}/health/ready`);
  assert.equal(readyResponse.status, 503);
  assert.deepEqual(await readyResponse.json(), {
    error: "master_key_malformed",
    status: "not_ready",
  });

  const productResponse = await fetch(`${origin}/api/v1/system`);
  assert.equal(productResponse.status, 503);
  assert.equal(
    await responseErrorCode(productResponse),
    "master_key_malformed",
  );
  assert.doesNotMatch(logs.join(""), new RegExp(secretValue));
});

test("an undecryptable installation key keeps product traffic unavailable", async () => {
  const databasePath = temporaryDatabasePath();
  const first = await startApplication(databasePath);
  await first.application.close();
  applications.splice(applications.indexOf(first.application), 1);

  const { origin } = await startApplication(databasePath, {
    loadInstallation() {
      return {
        externalOrigin: "http://127.0.0.1:3000",
        freeSpaceReserveBytes: 5 * 1024 ** 3,
        masterKey: Buffer.alloc(32, 8),
        trustedProxyAddresses: [],
      };
    },
  });

  const readyResponse = await fetch(`${origin}/health/ready`);
  assert.equal(readyResponse.status, 503);
  assert.deepEqual(await readyResponse.json(), {
    error: "master_key_undecryptable",
    status: "not_ready",
  });

  const productResponse = await fetch(`${origin}/api/v1/system`);
  assert.equal(productResponse.status, 503);
  assert.equal(
    await responseErrorCode(productResponse),
    "master_key_undecryptable",
  );
});

test("hard storage failure stops work, terminates Codex, and rejects every product surface", async () => {
  const { application, origin } = await startApplication(
    temporaryDatabasePath(),
  );
  const codexProcess = application.startCodexProcess(() =>
    spawn(process.execPath, [
      join(import.meta.dirname, "../fixtures/test-probes/idle-child.mjs"),
    ]),
  );
  const codexExited = new Promise((resolve) =>
    codexProcess.once("exit", () => resolve(undefined)),
  );

  const readyResponse = await fetch(`${origin}/health/ready`);
  assert.equal(readyResponse.status, 200);
  assert.deepEqual(await readyResponse.json(), { status: "ready" });

  assert.ok(application.durableCore);
  const durableCore = application.durableCore;
  durableCore.run("PRAGMA query_only = ON");
  assert.throws(
    () =>
      durableCore.transaction((transaction) => {
        transaction.run(
          "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
          "write_failure",
          "must-not-exist",
        );
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "storage_unavailable",
  );

  await codexExited;
  assert.equal(application.workerSignal.aborted, true);
  const workerFailure = /** @type {{code: string}} */ (
    application.workerSignal.reason
  );
  assert.equal(workerFailure.code, "storage_unavailable");

  for (const path of [
    "/",
    "/?view=system",
    "/api/v1/system",
    "/api/v1?resource=system",
    "/mcp/v1",
    "/mcp/v1?resource=system",
  ]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 503, path);
    assert.equal(await responseErrorCode(response), "storage_unavailable");
  }

  const liveAfterFailure = await fetch(`${origin}/health/live`);
  assert.equal(liveAfterFailure.status, 200);
  assert.deepEqual(await liveAfterFailure.json(), { status: "live" });

  const readyAfterFailure = await fetch(`${origin}/health/ready`);
  assert.equal(readyAfterFailure.status, 503);
  assert.deepEqual(await readyAfterFailure.json(), {
    error: "storage_unavailable",
    status: "not_ready",
  });
});
