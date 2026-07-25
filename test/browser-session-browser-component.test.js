import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createApplication } from "../src/application.js";
import { bootstrapOperatorPassword } from "../src/operator-password.js";
import { createApplicationServer } from "../src/server.js";

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
    now: options.now,
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
  const proxyHeaders = {
    forwarded: "for=203.0.113.24;host=quality-bar.example;proto=https",
  };

  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json", ...proxyHeaders },
    method: "POST",
  });
  assert.equal(login.status, 204);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /^quality_bar_session=[A-Za-z0-9_-]{43}; Path=\//);
  const csrfToken = cookie.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)?.[1];
  assert.match(csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Strict/);
  assert.match(cookie, /; Secure/);
  assert.doesNotMatch(cookie, /Domain=|Max-Age=|Bearer/i);

  const authenticated = await fetch(`${origin}/api/v1/system`, {
    headers: { cookie: cookie.split(";", 1)[0], ...proxyHeaders },
  });
  assert.equal(authenticated.status, 200);

  const authenticatedPage = await fetch(`${origin}/`, {
    headers: { cookie: cookie.split(";", 1)[0], ...proxyHeaders },
  });
  const authenticatedHtml = await authenticatedPage.text();
  assert.match(authenticatedHtml, /<button id="logout" type="button">Log out<\/button>/);
  assert.match(authenticatedHtml, /\/api\/v1\/session\/logout/);

  const logout = await fetch(`${origin}/api/v1/session/logout`, {
    headers: {
      cookie: `${cookie.match(/quality_bar_session=[A-Za-z0-9_-]{43}/)[0]}; quality_bar_csrf=${csrfToken}`,
      origin: "https://quality-bar.example",
      "x-quality-bar-csrf": csrfToken,
      ...proxyHeaders,
    },
    method: "POST",
  });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(
    (await fetch(`${origin}/api/v1/system`, {
      headers: { cookie: cookie.split(";", 1)[0], ...proxyHeaders },
    })).status,
    401,
  );
});

test("the authenticated browser shell has the fixed resource navigation and a System attention target", async () => {
  const { origin } = await startApplication();
  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];

  const evaluations = await fetch(`${origin}/`, { headers: { cookie } });
  const evaluationsHtml = await evaluations.text();
  assert.match(evaluationsHtml, /<h1>Evaluations<\/h1>/);
  assert.match(evaluationsHtml, /aria-label="Primary"/);
  for (const resource of ["Evaluations", "Reviews", "Repositories", "Analytics", "System"]) {
    assert.match(evaluationsHtml, new RegExp(`>${resource}<\\/a>`));
  }
  assert.match(evaluationsHtml, /id="attention"/);
  assert.doesNotMatch(evaluationsHtml, /Dashboard|notification|workflow/i);

  const system = await fetch(`${origin}/?view=system`, { headers: { cookie } });
  const systemHtml = await system.text();
  assert.match(systemHtml, /<h1>System<\/h1>/);
  assert.match(systemHtml, /id="system-facts"/);
  assert.match(systemHtml, /fetch\("\/api\/v1\/system"\)/);
  assert.match(systemHtml, /system\.bootstrap\.status/);
  assert.match(systemHtml, /system\.implementer_token\.status/);
  assert.match(systemHtml, /system\.codex\.error/);
  assert.match(systemHtml, /system\.codex\.catalog\.models/);
  assert.match(systemHtml, /reasoning_efforts/);
  assert.match(systemHtml, /service_tiers/);
});

test("browser activity refreshes a session only with its exact origin and session-bound CSRF token", async () => {
  let now = 1_000;
  const { application, origin } = await startApplication({ now: () => now });
  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookies = login.headers.get("set-cookie");
  const sessionCookie = cookies.match(/quality_bar_session=[A-Za-z0-9_-]{43}/)[0];
  const csrfToken = cookies.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)[1];
  const cookie = `${sessionCookie}; quality_bar_csrf=${csrfToken}`;
  const beforeRejectedActivity = application.durableCore.get(
    "SELECT session_hash, last_authenticated_at FROM browser_sessions",
  );

  const missingOrigin = await fetch(`${origin}/api/v1/session/activity`, {
    headers: { cookie, "x-quality-bar-csrf": csrfToken },
    method: "POST",
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal((await missingOrigin.json()).error.code, "origin_invalid");

  const wrongOrigin = await fetch(`${origin}/api/v1/session/activity`, {
    headers: {
      cookie,
      origin: "https://attacker.example",
      "x-quality-bar-csrf": csrfToken,
    },
    method: "POST",
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal((await wrongOrigin.json()).error.code, "origin_invalid");

  const missingToken = await fetch(`${origin}/api/v1/session/activity`, {
    headers: { cookie, origin: "http://127.0.0.1:3000" },
    method: "POST",
  });
  assert.equal(missingToken.status, 403);
  assert.equal((await missingToken.json()).error.code, "csrf_invalid");

  const wrongToken = await fetch(`${origin}/api/v1/session/activity`, {
    headers: {
      cookie,
      origin: "http://127.0.0.1:3000",
      "x-quality-bar-csrf": "A".repeat(43),
    },
    method: "POST",
  });
  assert.equal(wrongToken.status, 403);
  assert.equal((await wrongToken.json()).error.code, "csrf_invalid");

  const secondLogin = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const secondToken = secondLogin.headers
    .get("set-cookie")
    .match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)[1];
  const crossSessionToken = await fetch(`${origin}/api/v1/session/activity`, {
    headers: {
      cookie,
      origin: "http://127.0.0.1:3000",
      "x-quality-bar-csrf": secondToken,
    },
    method: "POST",
  });
  assert.equal(crossSessionToken.status, 403);
  assert.equal((await crossSessionToken.json()).error.code, "csrf_invalid");
  assert.deepEqual(
    application.durableCore.get(
      "SELECT last_authenticated_at FROM browser_sessions WHERE session_hash = ?",
      beforeRejectedActivity.session_hash,
    ),
    { last_authenticated_at: beforeRejectedActivity.last_authenticated_at },
  );

  now = 2_000;

  const activity = await fetch(`${origin}/api/v1/session/activity`, {
    headers: {
      cookie,
      origin: "http://127.0.0.1:3000",
      "x-quality-bar-csrf": csrfToken,
    },
    method: "POST",
  });
  assert.equal(activity.status, 204);
  assert.deepEqual(
    application.durableCore.get(
      "SELECT last_authenticated_at FROM browser_sessions WHERE last_authenticated_at = ?",
      2_000,
    ),
    { last_authenticated_at: 2_000 },
  );
});

test("every cookie-authenticated mutation rejects an absent origin or CSRF token before changing authority", async () => {
  const { application, origin } = await startApplication();
  const password = "a correct operator password";
  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookies = login.headers.get("set-cookie");
  const sessionCookie = cookies.match(/quality_bar_session=[A-Za-z0-9_-]{43}/)[0];
  const csrfToken = cookies.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)[1];
  const cookie = `${sessionCookie}; quality_bar_csrf=${csrfToken}`;

  for (const [path, body] of [
    ["/api/v1/session/logout", undefined],
    [
      "/api/v1/session/password",
      { current_password: password, new_password: "a replacement operator password" },
    ],
    [
      "/api/v1/sessions/revoke",
      { confirmation: "REVOKE ALL SESSIONS", password },
    ],
  ]) {
    const response = await fetch(`${origin}${path}`, {
      ...(body ? { body: JSON.stringify(body) } : {}),
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        cookie,
        "x-quality-bar-csrf": csrfToken,
      },
      method: "POST",
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "origin_invalid");
  }

  const absentCsrf = await fetch(`${origin}/api/v1/session/password`, {
    body: JSON.stringify({
      current_password: password,
      new_password: "a replacement operator password",
    }),
    headers: {
      "content-type": "application/json",
      cookie,
      origin: "http://127.0.0.1:3000",
    },
    method: "POST",
  });
  assert.equal(absentCsrf.status, 403);
  assert.equal((await absentCsrf.json()).error.code, "csrf_invalid");
  assert.equal(
    application.durableCore.get("SELECT COUNT(*) AS count FROM browser_sessions").count,
    1,
  );
  assert.equal(
    (await fetch(`${origin}/api/v1/system`, { headers: { cookie } })).status,
    200,
  );
});

test("browser activity makes an unexpected authority-recording failure secret-safe", async () => {
  const failure = new Error("unexpected recorder implementation detail");
  const server = createApplicationServer({
    browserOrigin: "http://127.0.0.1:3000",
    browserSessions: {
      authenticate() {
        return true;
      },
      changePassword() {},
      isBootstrapped() {
        return true;
      },
      login() {},
      logout() {},
      revokeAll() {},
      touch() {
        return false;
      },
      verifyCsrf() {
        return true;
      },
    },
    implementerTokens: {
      authenticate() {
        return false;
      },
      create() {},
      hasActiveToken() {
        return false;
      },
      revoke() {},
      rotate() {},
    },
    listAuthorityAttributions: () => ({ items: [], next_cursor: null }),
    recordAuthorityAttribution() {
      throw failure;
    },
    readDurableCoreStatus: () => ({ status: "ready" }),
    readSystemStatus: () => ({}),
    requestSecurity: { requestFacts() {} },
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${origin}/api/v1/session/activity`, {
      headers: { origin: "http://127.0.0.1:3000" },
      method: "POST",
    });
    assert.equal(response.status, 500);
    assert.deepEqual(Object.keys((await response.json()).error).sort(), [
      "code",
      "message",
      "request_id",
    ]);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
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

test("an expired browser session returns to login and preserves only a safe internal destination", async () => {
  const { application, origin } = await startApplication();
  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  application.durableCore.run(
    "UPDATE browser_sessions SET last_authenticated_at = 0",
  );

  const safeDestination = await fetch(
    `${origin}/?return_to=%2Fsystem%3Fsection%3Dsessions`,
    { headers: { cookie } },
  );
  const safeLoginPage = await safeDestination.text();
  assert.ok(
    safeLoginPage.includes('const intendedDestination = "/system?section=sessions";'),
  );
  assert.match(safeLoginPage, /location\.assign\(intendedDestination\)/);
  assert.doesNotMatch(safeLoginPage, /fetch\(intendedDestination/);

  const rejectedMutation = await fetch(`${origin}/api/v1/session/logout`, {
    headers: { cookie },
    method: "POST",
  });
  assert.equal(rejectedMutation.status, 401);
  const freshLogin = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const freshCookie = freshLogin.headers.get("set-cookie").split(";", 1)[0];
  const operatorPage = await fetch(`${origin}/`, {
    headers: { cookie: freshCookie },
  });
  const authenticatedHtml = await operatorPage.text();
  assert.match(authenticatedHtml, /returnToLoginAfterAuthenticationFailure/);
  assert.match(authenticatedHtml, /location\.assign\("\/\?return_to=" \+ encodeURIComponent\(location\.pathname \+ location\.search\)\)/);

  const unsafeDestination = await fetch(
    `${origin}/?return_to=https%3A%2F%2Fattacker.example%2Fsteal`,
  );
  const unsafeLoginPage = await unsafeDestination.text();
  assert.ok(unsafeLoginPage.includes('const intendedDestination = "/";'));
  assert.doesNotMatch(unsafeLoginPage, /attacker\.example/);
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
  const firstCookies = firstLogin.headers.get("set-cookie");
  const firstCookie = firstCookies.match(/quality_bar_session=[A-Za-z0-9_-]{43}/)[0];
  const firstCsrfToken = firstCookies.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)[1];
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
      cookie: `${firstCookie}; quality_bar_csrf=${firstCsrfToken}`,
      origin: "http://127.0.0.1:3000",
      "x-quality-bar-csrf": firstCsrfToken,
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
  const replacementCookies = replacementLogin.headers.get("set-cookie");
  const replacementCookie = replacementCookies
    .match(/quality_bar_session=[A-Za-z0-9_-]{43}/)[0];
  const replacementCsrfToken = replacementCookies
    .match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)[1];
  const revocation = await fetch(`${origin}/api/v1/sessions/revoke`, {
    body: JSON.stringify({
      confirmation: "REVOKE ALL SESSIONS",
      password: replacementPassword,
    }),
    headers: {
      "content-type": "application/json",
      cookie: `${replacementCookie}; quality_bar_csrf=${replacementCsrfToken}`,
      origin: "http://127.0.0.1:3000",
      "x-quality-bar-csrf": replacementCsrfToken,
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

test("the authenticated operator surface reveals each generated implementer token once and requires fresh confirmation", async () => {
  const { origin } = await startApplication();
  const password = "a correct operator password";
  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookies = login.headers.get("set-cookie");
  const sessionCookie = cookies.match(/quality_bar_session=[A-Za-z0-9_-]{43}/)[0];
  const csrfToken = cookies.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)[1];
  const headers = {
    "content-type": "application/json",
    cookie: `${sessionCookie}; quality_bar_csrf=${csrfToken}`,
    origin: "http://127.0.0.1:3000",
    "x-quality-bar-csrf": csrfToken,
  };

  const page = await fetch(`${origin}/`, { headers: { cookie: sessionCookie } });
  const html = await page.text();
  assert.match(html, /id="implementer-token-create-form"/);
  assert.match(html, /id="implementer-token-rotate-form"/);
  assert.match(html, /id="implementer-token-revoke-form"/);
  assert.match(html, /id="implementer-token-reveal"/);
  assert.match(html, /aria-labelledby="implementer-token-reveal-title"/);
  assert.match(html, /addEventListener\("close", \(\) => \{/);
  assert.match(html, /window\.confirm\("Revoke implementer token\? Machine access will remain disabled until a new token is created\."\)/);
  assert.doesNotMatch(html, /Bearer|localStorage/i);

  const created = await fetch(`${origin}/api/v1/implementer-token`, {
    body: JSON.stringify({ password }),
    headers,
    method: "POST",
  });
  assert.equal(created.status, 201);
  const createdToken = (await created.json()).token;
  assert.match(createdToken, /^[A-Za-z0-9_-]{43}$/);

  const duplicateCreate = await fetch(`${origin}/api/v1/implementer-token`, {
    body: JSON.stringify({ password }),
    headers,
    method: "POST",
  });
  assert.equal(duplicateCreate.status, 409);
  assert.equal((await duplicateCreate.json()).error.code, "implementer_token_already_active");

  const rotated = await fetch(`${origin}/api/v1/implementer-token/rotate`, {
    body: JSON.stringify({ password }),
    headers,
    method: "POST",
  });
  assert.equal(rotated.status, 200);
  assert.match((await rotated.json()).token, /^[A-Za-z0-9_-]{43}$/);

  const revoked = await fetch(`${origin}/api/v1/implementer-token/revoke`, {
    body: JSON.stringify({ password }),
    headers,
    method: "POST",
  });
  assert.equal(revoked.status, 204);
});
