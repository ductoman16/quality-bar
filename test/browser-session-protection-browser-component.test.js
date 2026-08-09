import assert from "node:assert/strict";
import { test } from "node:test";

import { createUnavailableReviewService } from "../src/review.js";
import { unavailableForgejoConnectionService } from "../src/forgejo-connection.js";
import { createUnavailableGitHubConnectionService } from "../src/github-connection.js";
import { createUnavailableEvaluationService } from "../src/evaluation.js";
import { createApplicationServer } from "../src/server.js";
import { createUnavailableWaiverAdjudicatorConfigurationService } from "../src/waiver-adjudicator-configuration.js";
import { startApplication } from "./browser-session-component-support.js";

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
    throw new Error("browser_protection_session_cookies_missing");
  }
  return { csrf, session };
}

test("browser activity refreshes a session only with its exact origin and session-bound CSRF token", async () => {
  let now = 1_000;
  const { application, origin } = await startApplication({ now: () => now });
  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { csrf: csrfToken, session: sessionCookie } = sessionCookies(login);
  const cookie = `${sessionCookie}; quality_bar_csrf=${csrfToken}`;
  const beforeRejectedActivity = application.durableCore.get(
    "SELECT session_hash, last_authenticated_at FROM browser_sessions",
  );

  const missingOrigin = await fetch(`${origin}/api/v1/session/activity`, {
    headers: { cookie, "x-quality-bar-csrf": csrfToken },
    method: "POST",
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(await responseErrorCode(missingOrigin), "origin_invalid");

  const wrongOrigin = await fetch(`${origin}/api/v1/session/activity`, {
    headers: {
      cookie,
      origin: "https://attacker.example",
      "x-quality-bar-csrf": csrfToken,
    },
    method: "POST",
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(await responseErrorCode(wrongOrigin), "origin_invalid");

  const missingToken = await fetch(`${origin}/api/v1/session/activity`, {
    headers: { cookie, origin: "http://127.0.0.1:3000" },
    method: "POST",
  });
  assert.equal(missingToken.status, 403);
  assert.equal(await responseErrorCode(missingToken), "csrf_invalid");

  const wrongToken = await fetch(`${origin}/api/v1/session/activity`, {
    headers: {
      cookie,
      origin: "http://127.0.0.1:3000",
      "x-quality-bar-csrf": "A".repeat(43),
    },
    method: "POST",
  });
  assert.equal(wrongToken.status, 403);
  assert.equal(await responseErrorCode(wrongToken), "csrf_invalid");

  const secondLogin = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { csrf: secondToken } = sessionCookies(secondLogin);
  const crossSessionToken = await fetch(`${origin}/api/v1/session/activity`, {
    headers: {
      cookie,
      origin: "http://127.0.0.1:3000",
      "x-quality-bar-csrf": secondToken,
    },
    method: "POST",
  });
  assert.equal(crossSessionToken.status, 403);
  assert.equal(await responseErrorCode(crossSessionToken), "csrf_invalid");
  if (!beforeRejectedActivity) {
    throw new Error("browser_protection_session_row_missing");
  }
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
  const { csrf: csrfToken, session: sessionCookie } = sessionCookies(login);
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
    ["/api/v1/repositories", { url: "https://example.com/repository.git" }],
    [
      "/api/v1/repositories/repository-1/credential/rotate",
      {
        token: "replacement-private-token",
        username: "replacement-operator",
      },
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
    assert.equal(await responseErrorCode(response), "origin_invalid");
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
  assert.equal(await responseErrorCode(absentCsrf), "csrf_invalid");
  const absentRepositoryCsrf = await fetch(`${origin}/api/v1/repositories`, {
    body: JSON.stringify({
      url: "https://example.com/repository.git",
    }),
    headers: {
      "content-type": "application/json",
      cookie,
      origin: "http://127.0.0.1:3000",
    },
    method: "POST",
  });
  assert.equal(absentRepositoryCsrf.status, 403);
  assert.equal(await responseErrorCode(absentRepositoryCsrf), "csrf_invalid");
  assert.equal(
    application.durableCore.get("SELECT COUNT(*) AS count FROM repositories")
      ?.count,
    0,
  );
  const sessionCount = application.durableCore.get(
    "SELECT COUNT(*) AS count FROM browser_sessions",
  );
  assert.equal(sessionCount?.count, 1);
  assert.equal(
    (await fetch(`${origin}/api/v1/system`, { headers: { cookie } })).status,
    200,
  );
});

test("browser activity makes an unexpected authority-recording failure secret-safe", async () => {
  const failure = new Error("unexpected recorder implementation detail");
  const server = createApplicationServer({
    browserOrigin: "http://127.0.0.1:3000",
    workerSignal: new AbortController().signal,
    codexExecutionConcurrency: {
      read: () => 1,
      set: (/** @type {unknown} */ value) => value,
    },
    evaluations: createUnavailableEvaluationService(
      new Error("unused Evaluation"),
    ),
    githubConnections: createUnavailableGitHubConnectionService(
      new Error("unused GitHub Connection"),
    ),
    forgejoConnections: unavailableForgejoConnectionService(
      new Error("unused Forgejo Connection"),
    ),
    browserSessions: {
      authenticate() {
        return true;
      },
      changePassword() {},
      isBootstrapped() {
        return true;
      },
      login() {
        throw new Error("unused browser session login");
      },
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
      create() {
        throw new Error("unused implementer token create");
      },
      hasActiveToken() {
        return false;
      },
      revoke() {},
      rotate() {
        throw new Error("unused implementer token rotate");
      },
    },
    onboardingTokens: {
      authenticate() {
        return null;
      },
      create() {
        throw new Error("unused onboarding token create");
      },
      list() {
        return [];
      },
      revoke() {},
      selfRevoke() {},
    },
    listAuthorityAttributions: () => ({ items: [], next_cursor: null }),
    recordAuthorityAttribution() {
      throw failure;
    },
    recordMcpOperation() {},
    readDurableCoreStatus: () => ({ status: "ready" }),
    readSystemStatus: () => ({}),
    waiverAdjudicatorConfiguration:
      createUnavailableWaiverAdjudicatorConfigurationService(
        new Error("unused Waiver Adjudicator Configuration"),
      ),
    repositories: {
      async acquireGitCredential() {
        throw new Error("unused Repository service operation");
      },
      destroy() {},
      list() {
        throw new Error("unused Repository service operation");
      },
      listPage() {
        throw new Error("unused Repository service operation");
      },
      async register() {
        throw new Error("unused Repository service operation");
      },
      async resolveForgejoPullRequestChangeset() {
        throw new Error("unused Repository service operation");
      },
      remove() {
        throw new Error("unused Repository service operation");
      },
      requireAcceptsNewWork() {
        throw new Error("unused Repository service operation");
      },
      async rotateCredential() {
        throw new Error("unused Repository service operation");
      },
      async setLifecycle() {
        throw new Error("unused Repository service operation");
      },
    },
    repositoryGuidance: {
      read() {
        throw new Error("unused Repository Guidance service operation");
      },
    },
    reviews: {
      ...createUnavailableReviewService(
        new Error("unused Review service operation"),
      ),
      list() {
        return [];
      },
    },
    requestSecurity: {
      requestFacts() {
        throw new Error("unused request facts");
      },
    },
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("browser_protection_server_address_unavailable");
  }
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${origin}/api/v1/session/activity`, {
      headers: { origin: "http://127.0.0.1:3000" },
      method: "POST",
    });
    assert.equal(response.status, 500);
    const body = /** @type {{error: Record<string, unknown>}} */ (
      await response.json()
    );
    assert.deepEqual(Object.keys(body.error).sort(), [
      "code",
      "message",
      "request_id",
    ]);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  }
});
