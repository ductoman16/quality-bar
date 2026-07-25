import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createApplication } from "../src/application.js";
import { CODEX_CAPABILITY_CATALOG } from "../src/codex-capabilities.js";
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

test("machine credentials are accepted only as a sole Authorization bearer value", async () => {
  const application = await startApplication(temporaryDatabasePath());
  const password = "a correct operator password";
  bootstrapOperatorPassword(application.application.durableCore, password);
  const token = application.application.implementerTokens.create(password);

  const validBearer = await fetch(`${application.origin}/api/v1/system`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(validBearer.status, 403);
  assert.equal((await validBearer.json()).error.code, "authorization_forbidden");

  const browserSurface = await fetch(`${application.origin}/`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(browserSurface.status, 403);
  assert.equal((await browserSurface.json()).error.code, "authorization_forbidden");

  const unauthenticatedUnknownQuery = await fetch(
    `${application.origin}/api/v1/system?unexpected=true`,
  );
  assert.equal(unauthenticatedUnknownQuery.status, 401);
  assert.equal((await unauthenticatedUnknownQuery.json()).error.code, "authentication_required");

  const forbiddenUnknownQuery = await fetch(
    `${application.origin}/api/v1/system?unexpected=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  assert.equal(forbiddenUnknownQuery.status, 403);
  assert.equal((await forbiddenUnknownQuery.json()).error.code, "authorization_forbidden");

  const mixedLogin = await fetch(`${application.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      cookie: "quality_bar_session=not-a-session",
    },
    method: "POST",
  });
  assert.equal(mixedLogin.status, 401);
  assert.equal((await mixedLogin.json()).error.code, "authentication_ambiguous");

  for (const [url, headers, expectedCode] of [
    [`${application.origin}/api/v1/system?ToKeN=${token}`, {}, "authentication_invalid"],
    [`${application.origin}/api/v1/system`, { authorization: token }, "authentication_invalid"],
    [
      `${application.origin}/api/v1/system`,
      { authorization: `Bearer ${token}`, cookie: "quality_bar_session=not-machine-auth" },
      "authentication_ambiguous",
    ],
  ]) {
    const response = await fetch(url, { headers });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, expectedCode);
  }
  assert.ok(
    application.application.durableCore.all(
      "SELECT action, channel, outcome, error_code FROM authority_attributions",
    ).some((event) =>
      event.action === "authentication" &&
      event.channel === "implementer_token" &&
      event.outcome === "failure" &&
      event.error_code === "authentication_invalid"
    ),
  );
  assert.ok(
    application.application.durableCore.all(
      "SELECT action, channel, outcome, error_code FROM authority_attributions",
    ).some((event) =>
      event.action === "authentication" &&
      event.channel === "browser_session" &&
      event.outcome === "failure" &&
      event.error_code === "authentication_ambiguous"
    ),
  );
});

test("the authenticated canonical contract is OpenAPI 3.1 with strict System attribution pagination", async () => {
  let now = Date.parse("2026-07-25T12:00:00.000Z");
  const application = await startApplication(temporaryDatabasePath(), {
    now: () => now,
  });
  const password = "a correct operator password";
  bootstrapOperatorPassword(application.application.durableCore, password);

  const unauthenticated = await fetch(`${application.origin}/api/v1/openapi.json`);
  assert.equal(unauthenticated.status, 401);
  const unauthenticatedError = await unauthenticated.json();
  assert.deepEqual(Object.keys(unauthenticatedError.error).sort(), [
    "code",
    "message",
    "request_id",
  ]);

  now += 1_000;
  const login = await fetch(`${application.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const token = application.application.implementerTokens.create(password);

  const openapi = await fetch(`${application.origin}/api/v1/openapi.json`, {
    headers: { cookie },
  });
  assert.equal(openapi.status, 200);
  const contract = await openapi.json();
  assert.equal(contract.openapi, "3.1.0");
  assert.equal(contract.components.schemas.Error.additionalProperties, true);
  assert.equal(contract.components.schemas.FieldError.additionalProperties, true);
  assert.equal(contract.components.schemas.System.additionalProperties, true);
  assert.equal(contract.components.schemas.BootstrapFact.additionalProperties, true);
  for (const schema of [
    "CurrentPasswordRequest",
    "LoginRequest",
    "PasswordChangeRequest",
    "SessionRevocationRequest",
  ]) {
    assert.equal(contract.components.schemas[schema].additionalProperties, false);
  }
  assert.deepEqual(contract.components.schemas.System.properties.codex, {
    $ref: "#/components/schemas/CodexFact",
  });
  assert.equal(
    contract.components.schemas.CodexCapabilityCatalog.properties.codex_cli_version.const,
    CODEX_CAPABILITY_CATALOG.codex_cli_version,
  );
  assert.deepEqual(
    contract.components.schemas.CodexCapabilityCatalog.const,
    CODEX_CAPABILITY_CATALOG,
  );
  assert.deepEqual(
    contract.components.schemas.CodexModelCapability.oneOf,
    CODEX_CAPABILITY_CATALOG.models.map((model) => ({
      additionalProperties: false,
      properties: {
        id: { const: model.id, type: "string" },
        reasoning_efforts: {
          items: { enum: model.reasoning_efforts, type: "string" },
          minItems: 1,
          type: "array",
        },
        service_tiers: {
          items: { enum: model.service_tiers, type: "string" },
          minItems: 1,
          type: "array",
        },
      },
      required: ["id", "reasoning_efforts", "service_tiers"],
      type: "object",
    })),
  );
  assert.equal(contract.components.schemas.AuthorityAttribution.properties.occurred_at.format, "date-time");
  assert.ok(contract.paths["/api/v1/system/authority-attributions"]);
  for (const path of [
    "/api/v1/session/logout",
    "/api/v1/session/activity",
    "/api/v1/session/password",
    "/api/v1/sessions/revoke",
    "/api/v1/implementer-token",
    "/api/v1/implementer-token/rotate",
    "/api/v1/implementer-token/revoke",
  ]) {
    assert.deepEqual(
      contract.paths[path].post.parameters.map(({ name, required }) => ({ name, required })),
      [
        { name: "Origin", required: true },
        { name: "x-quality-bar-csrf", required: true },
      ],
    );
  }
  assert.ok(contract.paths["/api/v1/session/logout"].post.responses[503]);
  assert.ok(contract.paths["/api/v1/session/logout"].post.responses[400]);
  assert.ok(contract.paths["/api/v1/session/activity"].post.responses[400]);
  assert.ok(contract.paths["/api/v1/openapi.json"].get.responses[400]);
  assert.ok(contract.paths["/api/v1/system"].get.responses[400]);
  assert.ok(contract.paths["/api/v1/system/authority-attributions"].get.responses[503]);

  const system = await fetch(`${application.origin}/api/v1/system`, {
    headers: { cookie },
  });
  assert.equal(system.status, 200);
  assert.deepEqual(await system.json(), {
    bootstrap: { status: "complete" },
    browser_sessions: { active_count: 1, status: "available" },
    codex: { catalog: CODEX_CAPABILITY_CATALOG, status: "available" },
    durable_core: { schema_version: 5, status: "ready" },
    implementer_token: { status: "active" },
  });

  const attributions = await fetch(
    `${application.origin}/api/v1/system/authority-attributions?limit=1`,
    { headers: { cookie } },
  );
  assert.equal(attributions.status, 200);
  const firstPage = await attributions.json();
  assert.equal(firstPage.items.length, 1);
  assert.match(firstPage.items[0].id, /^[0-9a-f-]{36}$/);
  assert.match(firstPage.items[0].occurred_at, /^2026-07-25T12:00:0[01]\.000Z$/);
  assert.equal(typeof firstPage.next_cursor, "string");
  assert.doesNotMatch(JSON.stringify(firstPage), new RegExp(`${password}|${token}`));

  const secondPage = await fetch(
    `${application.origin}/api/v1/system/authority-attributions?cursor=${encodeURIComponent(firstPage.next_cursor)}&limit=1`,
    { headers: { cookie } },
  );
  assert.equal(secondPage.status, 200);
  assert.notEqual((await secondPage.json()).items[0].id, firstPage.items[0].id);

  const malformed = await fetch(
    `${application.origin}/api/v1/system/authority-attributions?unexpected=true`,
    { headers: { cookie } },
  );
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "request_malformed");

  const oversized = await fetch(
    `${application.origin}/api/v1/system/authority-attributions?limit=101`,
    { headers: { cookie } },
  );
  assert.equal(oversized.status, 400);
  assert.equal((await oversized.json()).error.code, "page_size_invalid");

  const malformedCursor = await fetch(
    `${application.origin}/api/v1/system/authority-attributions?cursor=not-a-cursor`,
    { headers: { cookie } },
  );
  assert.equal(malformedCursor.status, 400);
  assert.equal((await malformedCursor.json()).error.code, "cursor_invalid");

  const unknownSystemQuery = await fetch(
    `${application.origin}/api/v1/system?unexpected=true`,
    { headers: { cookie } },
  );
  assert.equal(unknownSystemQuery.status, 400);
  assert.equal((await unknownSystemQuery.json()).error.code, "request_malformed");

  const unknownOpenApiQuery = await fetch(
    `${application.origin}/api/v1/openapi.json?unexpected=true`,
    { headers: { cookie } },
  );
  assert.equal(unknownOpenApiQuery.status, 400);
  assert.equal((await unknownOpenApiQuery.json()).error.code, "request_malformed");

  const unknownBrowserView = await fetch(`${application.origin}/?view=unknown`, {
    headers: { cookie },
  });
  assert.equal(unknownBrowserView.status, 404);
  assert.equal((await unknownBrowserView.json()).error.code, "not_found");

  const csrfToken = login.headers.get("set-cookie").match(
    /quality_bar_csrf=([A-Za-z0-9_-]{43})/,
  )[1];
  const unknownMutationQuery = await fetch(
    `${application.origin}/api/v1/session/logout?unexpected=true`,
    {
      headers: {
        cookie: `${cookie}; quality_bar_csrf=${csrfToken}`,
        origin: "http://127.0.0.1:3000",
        "x-quality-bar-csrf": csrfToken,
      },
      method: "POST",
    },
  );
  assert.equal(unknownMutationQuery.status, 400);
  assert.equal((await unknownMutationQuery.json()).error.code, "request_malformed");

  const machineContract = await fetch(`${application.origin}/api/v1/openapi.json`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(machineContract.status, 200);
  const machineSystem = await fetch(`${application.origin}/api/v1/system`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(machineSystem.status, 403);
  assert.equal((await machineSystem.json()).error.code, "authorization_forbidden");
});
