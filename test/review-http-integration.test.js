import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createConformingFetch } from "../scripts/openapi-conformance.mjs";
import { createApplication } from "../src/application.js";
import { canonicalOpenApiDocument } from "../src/canonical-api.js";
import { bootstrapOperatorPassword } from "../src/operator-password.js";

/** @typedef {ReturnType<typeof createApplication>} Application */
/**
 * @typedef {Application & {
 *   durableCore: NonNullable<Application["durableCore"]>,
 *   implementerTokens: NonNullable<Application["implementerTokens"]>,
 * }} ReadyApplication
 */
/** @type {Application[]} */
const applications = [];
/** @type {string[]} */
const temporaryDirectories = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-review-http-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

/** @param {{createReviews?: Parameters<typeof createApplication>[0]["createReviews"]}} [options] */
async function startApplication(options = {}) {
  const application = createApplication({
    databasePath: temporaryDatabasePath(),
    loadInstallation: () => ({
      externalOrigin: "http://127.0.0.1:3000",
      masterKey: Buffer.alloc(32, 7),
      trustedProxyAddresses: [],
    }),
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    validateTools() {},
    validateCodexAuthentication() {},
    createReviews: options.createReviews,
    writeLog() {},
  });
  if (!application.durableCore || !application.implementerTokens) {
    throw new Error("review_http_application_not_ready");
  }
  const readyApplication = /** @type {ReadyApplication} */ (application);
  bootstrapOperatorPassword(
    readyApplication.durableCore,
    "a correct operator password",
  );
  await new Promise((resolve, reject) => {
    readyApplication.server.once("error", reject);
    readyApplication.server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = readyApplication.server.address();
  if (!address || typeof address === "string") {
    throw new Error("review_http_server_address_unavailable");
  }
  applications.push(readyApplication);
  const origin = `http://127.0.0.1:${address.port}`;
  const conformingFetch = await createConformingFetch(
    canonicalOpenApiDocument(),
  );
  /** @param {string} path @param {RequestInit} [init] */
  const request = (path, init) => conformingFetch(new URL(path, origin), init);
  /** @param {string} path @param {RequestInit} [init] */
  const invalidRequest = (path, init) =>
    conformingFetch.invalidRequest(new URL(path, origin), init);
  request.invalidRequest = invalidRequest;
  return {
    application: readyApplication,
    request,
  };
}

/** @param {Record<string, unknown>} [overrides] */
function reviewRequest(overrides = {}) {
  return {
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact: "advisory",
        instruction: "Preserve request authentication boundaries.",
      },
    ],
    description: "Keep authenticated mutations safe.",
    name: "HTTP boundaries",
    ...overrides,
  };
}

/** @param {Response} response */
async function responseErrorCode(response) {
  const body = /** @type {{error: {code: string}}} */ (await response.json());
  return body.error.code;
}

/** @param {Response} response */
function sessionCookies(response) {
  const setCookie = response.headers.get("set-cookie");
  const session = setCookie?.match(
    /quality_bar_session=[A-Za-z0-9_-]{43}/,
  )?.[0];
  const csrf = setCookie?.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)?.[1];
  if (!session || !csrf) {
    throw new Error("review_http_session_cookies_missing");
  }
  return { csrf, session };
}

afterEach(async () => {
  for (const application of applications.splice(0)) {
    await application.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("an API-looking path outside the exact version boundary stays not found", async () => {
  const { request } = await startApplication();

  const response = await request("/api/v10?unexpected=value");

  assert.equal(response.status, 404);
  assert.equal(await responseErrorCode(response), "not_found");
});

test("the authenticated Review resource creates only an exact complete v1 snapshot", async () => {
  const { application, request } = await startApplication();
  const login = await request("/api/v1/session/login", {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { csrf, session } = sessionCookies(login);
  const headers = {
    "content-type": "application/json",
    cookie: `${session}; quality_bar_csrf=${csrf}`,
    origin: "http://127.0.0.1:3000",
    "x-quality-bar-csrf": csrf,
  };

  const created = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest()),
    headers,
    method: "POST",
  });
  assert.equal(created.status, 201);
  const createdReview = /** @type {{active_version: {number: number}}} */ (
    await created.json()
  );
  assert.equal(createdReview.active_version.number, 1);

  const rejected = await request.invalidRequest("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest({ unexpected: true })),
    headers,
    method: "POST",
  });
  assert.equal(rejected.status, 422);
  assert.equal(await responseErrorCode(rejected), "review_request_malformed");
  const reviewCount = application.durableCore.get(
    "SELECT count(*) AS count FROM reviews",
  );
  assert.equal(reviewCount?.count, 1);
});

test("a sole implementer bearer creates the same Review resource without browser CSRF", async () => {
  const { application, request } = await startApplication();
  const token = application.implementerTokens.create(
    "a correct operator password",
  );

  const created = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest({ name: "Machine HTTP boundaries" })),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  assert.equal(created.status, 201);
  const createdReview = /** @type {{name: string}} */ (await created.json());
  assert.equal(createdReview.name, "Machine HTTP boundaries");
});

test("an unexpected Review resource failure has an exact owning error", async () => {
  const failure = new Error("exact Review resource failure");
  const { request } = await startApplication({
    createReviews() {
      return {
        create() {
          throw failure;
        },
      };
    },
  });
  const login = await request("/api/v1/session/login", {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { csrf, session } = sessionCookies(login);
  const response = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest()),
    headers: {
      "content-type": "application/json",
      cookie: `${session}; quality_bar_csrf=${csrf}`,
      origin: "http://127.0.0.1:3000",
      "x-quality-bar-csrf": csrf,
    },
    method: "POST",
  });
  assert.equal(response.status, 500);
  const body =
    /** @type {{error: {code: string, message: string, request_id: string}}} */ (
      await response.json()
    );
  assert.equal(body.error.code, "review_creation_failed");
  assert.equal(body.error.message, "exact Review resource failure");
  assert.match(body.error.request_id, /^[0-9a-f-]{36}$/);
});
