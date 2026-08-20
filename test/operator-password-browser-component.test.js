import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createApplication } from "../src/application.js";
import { availableStorageReserve } from "./storage-reserve-support.js";
import { OPERATOR_PASSWORD_VERIFIER_METADATA_KEY } from "../src/operator-password.js";

/** @typedef {ReturnType<typeof createApplication>} Application */
/** @type {Application[]} */
const applications = [];
/** @type {string[]} */
const temporaryDirectories = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-browser-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

function validInstallation() {
  return {
    externalOrigin: "http://127.0.0.1:3000",
    freeSpaceReserveBytes: 5 * 1024 ** 3,
    masterKey: Buffer.alloc(32, 7),
    trustedProxyAddresses: [],
  };
}

afterEach(async () => {
  for (const application of applications.splice(0)) {
    await application.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("browser product traffic cannot bootstrap an operator password", async () => {
  const application = createApplication({
    createStorageReserve: () => availableStorageReserve,
    databasePath: temporaryDatabasePath(),
    loadInstallation: validInstallation,
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    validateTools() {},
    validateCodexAuthentication() {},
    writeLog() {},
  });
  if (!application.durableCore) {
    throw new Error("operator_password_browser_application_not_ready");
  }
  applications.push(application);
  await application.server.listen({ host: "127.0.0.1", port: 0 });
  const address = application.server.server.address();
  if (!address || typeof address === "string") {
    throw new Error("operator_password_browser_address_unavailable");
  }
  const { port } = address;

  const response = await fetch(
    `http://127.0.0.1:${port}/api/v1/operator-password/bootstrap`,
    {
      body: JSON.stringify({
        password: "a browser supplied operator password",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );

  assert.equal(response.status, 404);
  assert.equal(
    application.durableCore.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
    ),
    undefined,
  );
});
