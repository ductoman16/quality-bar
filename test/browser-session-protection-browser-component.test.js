import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationServer } from "../src/server.js";
import { startApplication } from "./browser-session-component-support.js";

test("browser activity refreshes a session only with its exact origin and session-bound CSRF token", async () => {
  let now = 1_000;
  const { application, origin } = await startApplication({ now: () => now });
  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookies = login.headers.get("set-cookie");
  const sessionCookie = cookies.match(
    /quality_bar_session=[A-Za-z0-9_-]{43}/,
  )[0];
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
  const sessionCookie = cookies.match(
    /quality_bar_session=[A-Za-z0-9_-]{43}/,
  )[0];
  const csrfToken = cookies.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)[1];
  const cookie = `${sessionCookie}; quality_bar_csrf=${csrfToken}`;

  for (const [path, body] of [
    ["/api/v1/session/logout", undefined],
    [
      "/api/v1/session/password",
      {
        current_password: password,
        new_password: "a replacement operator password",
      },
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
    application.durableCore.get(
      "SELECT COUNT(*) AS count FROM browser_sessions",
    ).count,
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
    reviews: { create() {} },
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
