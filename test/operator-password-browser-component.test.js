import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createApplication } from "../src/application.js";
import { OPERATOR_PASSWORD_VERIFIER_METADATA_KEY } from "../src/operator-password.js";

const applications = [];
const temporaryDirectories = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-browser-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

function validInstallation() {
  return {
    externalOrigin: "http://127.0.0.1:3000",
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
    databasePath: temporaryDatabasePath(),
    loadInstallation: validInstallation,
    validateInstallation: () => ({}),
    validateSources() {},
    validateTools() {},
    validateCodexAuthentication() {},
    writeLog() {},
  });
  applications.push(application);
  await new Promise((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = application.server.address();

  const response = await fetch(
    `http://127.0.0.1:${port}/api/v1/operator-password/bootstrap`,
    {
      body: JSON.stringify({ password: "a browser supplied operator password" }),
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
