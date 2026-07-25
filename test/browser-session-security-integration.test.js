import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createApplication } from "../src/application.js";
import { bootstrapOperatorPassword } from "../src/operator-password.js";

const applications = [];
const temporaryDirectories = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-session-security-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

async function startApplication(databasePath) {
  const application = createApplication({
    databasePath,
    loadInstallation: () => ({
      externalOrigin: "http://127.0.0.1:3000",
      masterKey: Buffer.alloc(32, 7),
      trustedProxyAddresses: [],
    }),
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
  return { application, origin: `http://127.0.0.1:${application.server.address().port}` };
}

afterEach(async () => {
  for (const application of applications.splice(0)) {
    await application.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("sessions survive a service restart but an uninitialized operator cannot log in", async () => {
  const databasePath = temporaryDatabasePath();
  const first = await startApplication(databasePath);

  const unavailableLogin = await fetch(`${first.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(unavailableLogin.status, 503);
  assert.equal((await unavailableLogin.json()).error.code, "operator_password_uninitialized");

  bootstrapOperatorPassword(first.application.durableCore, "a correct operator password");
  const login = await fetch(`${first.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  await first.application.close();
  applications.splice(applications.indexOf(first.application), 1);

  const second = await startApplication(databasePath);
  const system = await fetch(`${second.origin}/api/v1/system`, {
    headers: { cookie },
  });
  assert.equal(system.status, 200);
});
