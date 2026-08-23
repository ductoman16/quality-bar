import assert from "node:assert/strict";
import { test } from "node:test";

import { CODEX_CAPABILITY_CATALOG } from "../src/codex/codex-capabilities.js";
import { bootstrapOperatorPassword } from "../src/operator/operator-password.js";
import {
  startApplication,
  temporaryDatabasePath,
} from "./browser-session-security-integration-support.js";
import { availableStorageReserve } from "./storage-reserve-support.js";
import {
  expectedSystemApplication,
  expectedSystemBackup,
  expectedSystemDurableCore,
} from "./system-storage-expected.js";

/** @param {Response} response */
async function responseErrorCode(response) {
  const body = /** @type {{error: {code: string}}} */ (await response.json());
  return body.error.code;
}

/** @param {Response} response */
function responseCookie(response) {
  const cookie = response.headers.get("set-cookie");
  if (!cookie) {
    throw new Error("security_integration_cookie_missing");
  }
  return cookie;
}

test("the authenticated System surface enforces attribution pagination and CSRF, and confirms the OpenAPI contract endpoint is retired", async () => {
  let now = Date.parse("2026-07-25T12:00:00.000Z");
  const application = await startApplication(temporaryDatabasePath(), {
    now: () => now,
  });
  const password = "a correct operator password";
  bootstrapOperatorPassword(application.application.durableCore, password);

  const unauthenticatedSystem = await fetch(
    `${application.origin}/api/v1/system`,
  );
  assert.equal(unauthenticatedSystem.status, 401);
  const unauthenticatedError = /** @type {{error: Record<string, unknown>}} */ (
    await unauthenticatedSystem.json()
  );
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
  const setCookie = responseCookie(login);
  const cookie = setCookie.split(";", 1)[0];
  const token = application.application.implementerTokens.create(password);

  const retiredContract = await fetch(
    `${application.origin}/api/v1/openapi.json`,
    { headers: { cookie } },
  );
  assert.equal(retiredContract.status, 404);
  assert.equal(await responseErrorCode(retiredContract), "not_found");

  const system = await fetch(`${application.origin}/api/v1/system`, {
    headers: { cookie },
  });
  assert.equal(system.status, 200);
  const systemFacts = /** @type {any} */ (await system.json());
  assert.deepEqual(systemFacts, {
    application: expectedSystemApplication,
    backup: expectedSystemBackup,
    bootstrap: { status: "complete" },
    browser_sessions: { active_count: 1, status: "available" },
    codex: { catalog: CODEX_CAPABILITY_CATALOG, status: "available" },
    execution_providers: [{ id: "codex", name: "Codex", status: "available" }],
    codex_execution: {
      concurrency: {
        maximum_running: 1,
        running_count: 0,
        start_gate: "available",
      },
      failures: [],
      queue: { count: 0, rows: [] },
      running: { count: 0, rows: [] },
    },
    delivery: { surfaces: [] },
    durable_core: expectedSystemDurableCore(systemFacts.durable_core),
    implementer_token: { status: "active" },
    polling: { connections: [] },
    storage: availableStorageReserve.readFacts(),
  });

  const attributions = await fetch(
    `${application.origin}/api/v1/system/authority-attributions?limit=1`,
    { headers: { cookie } },
  );
  assert.equal(attributions.status, 200);
  const firstPage = /** @type {{
   *   items: {id: string, occurred_at: string}[],
   *   next_cursor: string,
   * }} */ (await attributions.json());
  assert.equal(firstPage.items.length, 1);
  assert.match(firstPage.items[0].id, /^[0-9a-f-]{36}$/);
  assert.match(
    firstPage.items[0].occurred_at,
    /^2026-07-25T12:00:0[01]\.000Z$/,
  );
  assert.equal(typeof firstPage.next_cursor, "string");
  assert.doesNotMatch(
    JSON.stringify(firstPage),
    new RegExp(`${password}|${token}`),
  );

  const secondPage = await fetch(
    `${application.origin}/api/v1/system/authority-attributions?cursor=${encodeURIComponent(firstPage.next_cursor)}&limit=1`,
    { headers: { cookie } },
  );
  assert.equal(secondPage.status, 200);
  const secondPageBody = /** @type {{items: {id: string}[]}} */ (
    await secondPage.json()
  );
  assert.notEqual(secondPageBody.items[0].id, firstPage.items[0].id);

  for (const [url, expectedCode] of [
    [
      `${application.origin}/api/v1/system/authority-attributions?unexpected=true`,
      "request_malformed",
    ],
    [
      `${application.origin}/api/v1/system/authority-attributions?limit=101`,
      "page_size_invalid",
    ],
    [
      `${application.origin}/api/v1/system/authority-attributions?cursor=not-a-cursor`,
      "cursor_invalid",
    ],
    [
      `${application.origin}/api/v1/system?unexpected=true`,
      "request_malformed",
    ],
  ]) {
    const response = await fetch(url, { headers: { cookie } });
    assert.equal(response.status, 400);
    assert.equal(await responseErrorCode(response), expectedCode);
  }

  const unknownBrowserView = await fetch(
    `${application.origin}/?view=unknown`,
    {
      headers: { cookie },
    },
  );
  assert.equal(unknownBrowserView.status, 404);
  assert.equal(await responseErrorCode(unknownBrowserView), "not_found");

  const csrfMatch = setCookie.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/);
  if (!csrfMatch) {
    throw new Error("security_integration_csrf_cookie_missing");
  }
  const csrfToken = csrfMatch[1];
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
  assert.equal(
    await responseErrorCode(unknownMutationQuery),
    "request_malformed",
  );

  const machineSystem = await fetch(`${application.origin}/api/v1/system`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(machineSystem.status, 403);
  assert.equal(
    await responseErrorCode(machineSystem),
    "authorization_forbidden",
  );
});
