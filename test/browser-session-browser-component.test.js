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
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-session-browser-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

function validInstallation(origin = "http://127.0.0.1:3000") {
  return {
    externalOrigin: origin,
    masterKey: Buffer.alloc(32, 7),
    trustedProxyAddresses: origin.startsWith("https:") ? ["127.0.0.1"] : [],
  };
}

async function startApplication(options = {}) {
  const application = createApplication({
    databasePath: temporaryDatabasePath(),
    loadInstallation: () => validInstallation(options.externalOrigin),
    validateInstallation: () => ({}),
    validateSources() {},
    validateTools() {},
    validateCodexAuthentication() {},
    writeLog() {},
  });
  applications.push(application);
  if (options.bootstrap !== false) {
    bootstrapOperatorPassword(application.durableCore, "a correct operator password");
  }
  await new Promise((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    application,
    origin: `http://127.0.0.1:${application.server.address().port}`,
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

test("the minimum unauthenticated surface exposes the password-only login and no product data", async () => {
  const { origin } = await startApplication();

  const login = await fetch(`${origin}/`);
  assert.match(login.headers.get("content-type"), /^text\/html/);
  const loginPage = await login.text();
  assert.match(loginPage, /<label for="password">Password<\/label>/);
  assert.match(loginPage, /<button type="submit">Log in<\/button>/);
  assert.match(loginPage, /\/api\/v1\/session\/login/);
  assert.doesNotMatch(loginPage, /username|signup|remember|recovery|localStorage|Bearer/i);

  const system = await fetch(`${origin}/api/v1/system`);
  assert.equal(system.status, 401);
  assert.equal((await system.json()).error.code, "authentication_required");
});

test("a password login sets only an HttpOnly Strict host-only cookie and logout clears it", async () => {
  const { origin } = await startApplication({ externalOrigin: "https://quality-bar.example" });

  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(login.status, 204);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /^quality_bar_session=[A-Za-z0-9_-]{43}; Path=\//);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Strict/);
  assert.match(cookie, /; Secure/);
  assert.doesNotMatch(cookie, /Domain=|Max-Age=|Bearer/i);

  const authenticated = await fetch(`${origin}/api/v1/system`, {
    headers: { cookie: cookie.split(";", 1)[0] },
  });
  assert.equal(authenticated.status, 200);

  const authenticatedPage = await fetch(`${origin}/`, {
    headers: { cookie: cookie.split(";", 1)[0] },
  });
  const authenticatedHtml = await authenticatedPage.text();
  assert.match(authenticatedHtml, /<button id="logout" type="button">Log out<\/button>/);
  assert.match(authenticatedHtml, /\/api\/v1\/session\/logout/);

  const logout = await fetch(`${origin}/api/v1/session/logout`, {
    headers: { cookie: cookie.split(";", 1)[0] },
    method: "POST",
  });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(
    (await fetch(`${origin}/api/v1/system`, {
      headers: { cookie: cookie.split(";", 1)[0] },
    })).status,
    401,
  );
});

test("a malformed login request creates no session", async () => {
  const { application, origin } = await startApplication();

  const response = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password", unexpected: true }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "request_malformed");
  assert.equal(application.durableCore.get("SELECT session_hash FROM browser_sessions"), undefined);
});

test("the login surface reports one explicit throttled response without revealing password validity", async () => {
  const { origin } = await startApplication();

  const failedLogin = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "an incorrect operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(failedLogin.status, 401);

  const throttledCorrectPassword = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const throttledIncorrectPassword = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "another incorrect operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  assert.equal(throttledCorrectPassword.status, 429);
  assert.equal(throttledCorrectPassword.headers.get("retry-after"), "1");
  assert.equal(throttledCorrectPassword.headers.get("set-cookie"), null);
  const correctPasswordError = await throttledCorrectPassword.json();
  const incorrectPasswordError = await throttledIncorrectPassword.json();
  assert.deepEqual(correctPasswordError.error, {
    code: "login_throttled",
    message: "Login is temporarily throttled",
    request_id: correctPasswordError.error.request_id,
  });
  assert.deepEqual(incorrectPasswordError.error, {
    code: "login_throttled",
    message: "Login is temporarily throttled",
    request_id: incorrectPasswordError.error.request_id,
  });
});

test("the authenticated operator surface changes a password and revokes all sessions with fresh confirmation", async () => {
  const { origin } = await startApplication();
  const currentPassword = "a correct operator password";
  const replacementPassword = "a replacement operator password";
  const firstLogin = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: currentPassword }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const firstCookie = firstLogin.headers.get("set-cookie").split(";", 1)[0];
  const secondLogin = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: currentPassword }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const secondCookie = secondLogin.headers.get("set-cookie").split(";", 1)[0];

  const authenticatedPage = await fetch(`${origin}/`, {
    headers: { cookie: firstCookie },
  });
  const authenticatedHtml = await authenticatedPage.text();
  assert.match(authenticatedHtml, /id="password-change-form"/);
  assert.match(authenticatedHtml, /\/api\/v1\/session\/password/);
  assert.match(authenticatedHtml, /id="session-revocation-form"/);
  assert.match(authenticatedHtml, /\/api\/v1\/sessions\/revoke/);
  assert.match(authenticatedHtml, /REVOKE ALL SESSIONS/);
  assert.doesNotMatch(authenticatedHtml, /localStorage|Bearer/i);

  const passwordChange = await fetch(`${origin}/api/v1/session/password`, {
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: replacementPassword,
    }),
    headers: {
      "content-type": "application/json",
      cookie: firstCookie,
    },
    method: "POST",
  });
  assert.equal(passwordChange.status, 204);
  assert.match(passwordChange.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(
    (await fetch(`${origin}/api/v1/system`, { headers: { cookie: firstCookie } })).status,
    401,
  );
  assert.equal(
    (await fetch(`${origin}/api/v1/system`, { headers: { cookie: secondCookie } })).status,
    401,
  );

  const replacementLogin = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: replacementPassword }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const replacementCookie = replacementLogin.headers
    .get("set-cookie")
    .split(";", 1)[0];
  const revocation = await fetch(`${origin}/api/v1/sessions/revoke`, {
    body: JSON.stringify({
      confirmation: "REVOKE ALL SESSIONS",
      password: replacementPassword,
    }),
    headers: {
      "content-type": "application/json",
      cookie: replacementCookie,
    },
    method: "POST",
  });
  assert.equal(revocation.status, 204);
  assert.match(revocation.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(
    (await fetch(`${origin}/api/v1/system`, {
      headers: { cookie: replacementCookie },
    })).status,
    401,
  );
});
