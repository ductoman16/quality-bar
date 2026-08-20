import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createApplication } from "../src/application.js";
import { openDurableCore } from "../src/durable-core.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

/** @type {ReturnType<typeof createApplication>[]} */
const applications = [];
/** @type {string[]} */
const temporaryDirectories = [];

function installation() {
  return {
    externalOrigin: "http://127.0.0.1:3000",
    freeSpaceReserveBytes: 5 * 1024 ** 3,
    masterKey: Buffer.alloc(32, 7),
    trustedProxyAddresses: [],
  };
}

function databasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-upgrade-failure-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

/** @param {string} path */
function seedFailedForwardMigration(path) {
  const current = openDurableCore(path);
  current.close();
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE upgrade_failure_parents (
      id INTEGER PRIMARY KEY
    ) STRICT;
    CREATE TABLE upgrade_failure_children (
      parent_id INTEGER NOT NULL REFERENCES upgrade_failure_parents(id)
    ) STRICT;
    INSERT INTO upgrade_failure_children (parent_id) VALUES (999);
    UPDATE quality_bar_metadata SET value = '47' WHERE key = 'schema_version';
    PRAGMA user_version = 47;
  `);
  database.close();
}

/** @param {string} path */
async function startApplication(path) {
  const application = createApplication({
    databasePath: path,
    createStorageReserve: () => availableStorageReserve,
    loadInstallation: installation,
    validateCodexAuthentication() {},
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    validateTools() {},
    writeLog() {},
  });
  applications.push(application);
  await application.server.listen({ host: "127.0.0.1", port: 0 });
  const address = application.server.server.address();
  if (!address || typeof address === "string") {
    throw new Error("upgrade_failure_server_address_missing");
  }
  return { application, origin: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  for (const application of applications.splice(0)) {
    await application.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a failed forward migration leaves the service unavailable and the original database authoritative", async () => {
  const path = databasePath();
  seedFailedForwardMigration(path);

  const { application, origin } = await startApplication(path);
  assert.equal(application.durableCore, null);

  const liveResponse = await fetch(`${origin}/health/live`);
  assert.equal(liveResponse.status, 200);
  assert.deepEqual(await liveResponse.json(), { status: "live" });

  const readyResponse = await fetch(`${origin}/health/ready`);
  assert.equal(readyResponse.status, 503);
  assert.deepEqual(await readyResponse.json(), {
    error: "foreign_key_check_failed",
    status: "not_ready",
  });

  const unchanged = new DatabaseSync(path, { readOnly: true });
  assert.equal(
    unchanged.prepare("PRAGMA user_version").get()?.user_version,
    47,
  );
  assert.equal(
    unchanged
      .prepare(
        "SELECT value FROM quality_bar_metadata WHERE key = 'schema_version'",
      )
      .get()?.value,
    "47",
  );
  assert.equal(
    unchanged
      .prepare("SELECT COUNT(*) AS count FROM upgrade_failure_children")
      .get()?.count,
    1,
  );
  unchanged.close();

  await application.close();
  applications.splice(applications.indexOf(application), 1);
});
