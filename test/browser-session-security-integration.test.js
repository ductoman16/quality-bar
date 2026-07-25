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

async function startApplication(
  databasePath,
  {
    externalOrigin = "http://127.0.0.1:3000",
    now,
    trustedProxyAddresses = [],
  } = {},
) {
  const application = createApplication({
    databasePath,
    loadInstallation: () => ({
      externalOrigin,
      masterKey: Buffer.alloc(32, 7),
      trustedProxyAddresses,
    }),
    validateInstallation: () => ({}),
    validateSources() {},
    validateTools() {},
    validateCodexAuthentication() {},
    writeLog() {},
    now,
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
  const csrfToken = login.headers.get("set-cookie").match(
    /quality_bar_csrf=([A-Za-z0-9_-]{43})/,
  )[1];
  await first.application.close();
  applications.splice(applications.indexOf(first.application), 1);

  const second = await startApplication(databasePath);
  const system = await fetch(`${second.origin}/api/v1/system`, {
    headers: { cookie },
  });
  assert.equal(system.status, 200);
});

test("idle and absolute expiry remain enforced after a service restart", async () => {
  const databasePath = temporaryDatabasePath();
  let now = 1_000;
  const first = await startApplication(databasePath, { now: () => now });
  bootstrapOperatorPassword(first.application.durableCore, "a correct operator password");
  const idleLogin = await fetch(`${first.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookies = idleLogin.headers.get("set-cookie");
  const sessionCookie = cookies.match(/quality_bar_session=[A-Za-z0-9_-]{43}/)[0];
  const csrfToken = cookies.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)[1];
  now += 6 * 24 * 60 * 60 * 1_000;
  const activity = await fetch(`${first.origin}/api/v1/session/activity`, {
    headers: {
      cookie: `${sessionCookie}; quality_bar_csrf=${csrfToken}`,
      origin: "http://127.0.0.1:3000",
      "x-quality-bar-csrf": csrfToken,
    },
    method: "POST",
  });
  assert.equal(activity.status, 204);
  await first.application.close();
  applications.splice(applications.indexOf(first.application), 1);

  now += 6 * 24 * 60 * 60 * 1_000;
  const second = await startApplication(databasePath, { now: () => now });
  const refreshedSystem = await fetch(`${second.origin}/api/v1/system`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(refreshedSystem.status, 200);
  now = 1_000 + 30 * 24 * 60 * 60 * 1_000;
  const absoluteSystem = await fetch(`${second.origin}/api/v1/system`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(absoluteSystem.status, 401);
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
  const csrfToken = login.headers.get("set-cookie").match(
    /quality_bar_csrf=([A-Za-z0-9_-]{43})/,
  )[1];

  const rejectedPasswordChange = await fetch(
    `${application.origin}/api/v1/session/password`,
    {
      body: JSON.stringify({
        current_password: "an incorrect operator password",
        new_password: "a replacement operator password",
      }),
      headers: {
        "content-type": "application/json",
        cookie: `${cookie}; quality_bar_csrf=${csrfToken}`,
        origin: "http://127.0.0.1:3000",
        "x-quality-bar-csrf": csrfToken,
      },
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
      headers: {
        "content-type": "application/json",
        cookie: `${cookie}; quality_bar_csrf=${csrfToken}`,
        origin: "http://127.0.0.1:3000",
        "x-quality-bar-csrf": csrfToken,
      },
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

test("a trusted HTTPS proxy preserves authentication while direct, mixed, and identity-header requests do not bypass it", async () => {
  const application = await startApplication(temporaryDatabasePath(), {
    externalOrigin: "https://quality-bar.example",
    trustedProxyAddresses: ["127.0.0.1"],
  });
  const password = "a correct operator password";
  bootstrapOperatorPassword(application.application.durableCore, password);
  const forwarded = "for=203.0.113.24;host=quality-bar.example;proto=https";

  const directLogin = await fetch(`${application.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(directLogin.status, 400);
  assert.equal((await directLogin.json()).error.code, "proxy_forwarded_required");

  const login = await fetch(`${application.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json", forwarded },
    method: "POST",
  });
  assert.equal(login.status, 204);
  const cookies = login.headers.get("set-cookie");
  const sessionCookie = cookies.match(/quality_bar_session=[A-Za-z0-9_-]{43}/)[0];
  const csrfToken = cookies.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)[1];
  const cookie = `${sessionCookie}; quality_bar_csrf=${csrfToken}`;

  const mixedCredentials = await fetch(`${application.origin}/api/v1/session/activity`, {
    headers: {
      authorization: "Bearer an-unimplemented-token",
      cookie,
      forwarded,
      origin: "https://quality-bar.example",
      "x-quality-bar-csrf": csrfToken,
    },
    method: "POST",
  });
  assert.equal(mixedCredentials.status, 401);
  assert.equal((await mixedCredentials.json()).error.code, "authentication_ambiguous");

  const mixedLogin = await fetch(`${application.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password }),
    headers: {
      authorization: "Bearer an-unimplemented-token",
      cookie,
      "content-type": "application/json",
      forwarded,
    },
    method: "POST",
  });
  assert.equal(mixedLogin.status, 401);
  assert.equal((await mixedLogin.json()).error.code, "authentication_ambiguous");

  const duplicateSessionCookieLogin = await fetch(
    `${application.origin}/api/v1/session/login`,
    {
      body: JSON.stringify({ password }),
      headers: {
        authorization: "Bearer an-unimplemented-token",
        cookie: "quality_bar_session=first; quality_bar_session=second",
        "content-type": "application/json",
        forwarded,
      },
      method: "POST",
    },
  );
  assert.equal(duplicateSessionCookieLogin.status, 401);
  assert.equal(
    (await duplicateSessionCookieLogin.json()).error.code,
    "authentication_ambiguous",
  );

  const mixedRoot = await fetch(`${application.origin}/`, {
    headers: {
      authorization: "Bearer an-unimplemented-token",
      cookie,
      forwarded,
    },
  });
  assert.equal(mixedRoot.status, 401);
  assert.equal((await mixedRoot.json()).error.code, "authentication_ambiguous");

  const identityHeader = await fetch(`${application.origin}/api/v1/system`, {
    headers: { forwarded, "x-remote-user": "operator" },
  });
  assert.equal(identityHeader.status, 401);
  assert.equal((await identityHeader.json()).error.code, "authentication_required");
});
