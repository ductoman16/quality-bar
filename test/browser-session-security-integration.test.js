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

test("a failed-login delay survives a service restart and blocks a correct password before verification", async () => {
  const databasePath = temporaryDatabasePath();
  const first = await startApplication(databasePath);
  bootstrapOperatorPassword(first.application.durableCore, "a correct operator password");

  const failedLogin = await fetch(`${first.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "an incorrect operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(failedLogin.status, 401);
  await first.application.close();
  applications.splice(applications.indexOf(first.application), 1);

  const second = await startApplication(databasePath);
  const throttledLogin = await fetch(`${second.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(throttledLogin.status, 429);
  assert.equal((await throttledLogin.json()).error.code, "login_throttled");
  assert.equal(throttledLogin.headers.get("set-cookie"), null);
});

test("password and global-session mutations keep durable authority unchanged after a rejected confirmation", async () => {
  const application = await startApplication(temporaryDatabasePath());
  const password = "a correct operator password";
  bootstrapOperatorPassword(application.application.durableCore, password);
  const login = await fetch(`${application.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];

  const rejectedPasswordChange = await fetch(
    `${application.origin}/api/v1/session/password`,
    {
      body: JSON.stringify({
        current_password: "an incorrect operator password",
        new_password: "a replacement operator password",
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    },
  );
  assert.equal(rejectedPasswordChange.status, 401);
  const passwordChangeError = await rejectedPasswordChange.json();
  assert.equal(passwordChangeError.error.code, "authentication_invalid");
  assert.doesNotMatch(JSON.stringify(passwordChangeError), /incorrect|replacement/);

  const rejectedRevocation = await fetch(
    `${application.origin}/api/v1/sessions/revoke`,
    {
      body: JSON.stringify({ confirmation: "no", password }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    },
  );
  assert.equal(rejectedRevocation.status, 422);
  const revocationError = await rejectedRevocation.json();
  assert.equal(
    revocationError.error.code,
    "session_revocation_confirmation_invalid",
  );
  assert.doesNotMatch(JSON.stringify(revocationError), /correct operator password/);

  const authenticated = await fetch(`${application.origin}/api/v1/system`, {
    headers: { cookie },
  });
  assert.equal(authenticated.status, 200);
  const replacementLogin = await fetch(`${application.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a replacement operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(replacementLogin.status, 401);
});
