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
