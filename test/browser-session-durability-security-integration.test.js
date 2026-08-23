import assert from "node:assert/strict";
import { test } from "node:test";

import { bootstrapOperatorPassword } from "../src/operator/operator-password.js";
import {
  closeApplication,
  startApplication,
  temporaryDatabasePath,
} from "./browser-session-security-integration-support.js";

/** @param {Response} response */
async function responseErrorCode(response) {
  const body = /** @type {{error: {code: string}}} */ (await response.json());
  return body.error.code;
}

/** @param {Response} response */
function sessionCookies(response) {
  const cookies = response.headers.get("set-cookie");
  const session = cookies?.match(/quality_bar_session=[A-Za-z0-9_-]{43}/)?.[0];
  const csrf = cookies?.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)?.[1];
  if (!session || !csrf) {
    throw new Error("session_durability_cookies_missing");
  }
  return { csrf, session };
}

test("sessions survive a service restart but an uninitialized operator cannot log in", async () => {
  const databasePath = temporaryDatabasePath();
  const first = await startApplication(databasePath);

  const unavailableLogin = await fetch(`${first.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(unavailableLogin.status, 503);
  assert.equal(
    await responseErrorCode(unavailableLogin),
    "operator_password_uninitialized",
  );

  bootstrapOperatorPassword(
    first.application.durableCore,
    "a correct operator password",
  );
  const login = await fetch(`${first.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { session: cookie } = sessionCookies(login);
  await closeApplication(first.application);

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
  bootstrapOperatorPassword(
    first.application.durableCore,
    "a correct operator password",
  );
  const idleLogin = await fetch(`${first.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { csrf: csrfToken, session: sessionCookie } = sessionCookies(idleLogin);
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
  await closeApplication(first.application);

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
  const now = () => 1_000;
  const first = await startApplication(databasePath, { now });
  bootstrapOperatorPassword(
    first.application.durableCore,
    "a correct operator password",
  );

  const failedLogin = await fetch(`${first.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "an incorrect operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(failedLogin.status, 401);
  await closeApplication(first.application);

  const second = await startApplication(databasePath, { now });
  const throttledLogin = await fetch(`${second.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(throttledLogin.status, 429);
  assert.equal(await responseErrorCode(throttledLogin), "login_throttled");
  assert.equal(throttledLogin.headers.get("set-cookie"), null);
});
