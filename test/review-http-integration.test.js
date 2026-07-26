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
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-review-http-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

async function startApplication(options = {}) {
  const application = createApplication({
    databasePath: temporaryDatabasePath(),
    loadInstallation: () => ({
      externalOrigin: "http://127.0.0.1:3000",
      masterKey: Buffer.alloc(32, 7),
      trustedProxyAddresses: [],
    }),
    validateInstallation: () => ({}),
    validateSources() {},
    validateTools() {},
    validateCodexAuthentication() {},
    createReviews: options.createReviews,
    writeLog() {},
  });
  bootstrapOperatorPassword(
    application.durableCore,
    "a correct operator password",
  );
  await new Promise((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(0, "127.0.0.1", resolve);
  });
  applications.push(application);
  return {
    application,
    origin: `http://127.0.0.1:${application.server.address().port}`,
  };
}

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

afterEach(async () => {
  for (const application of applications.splice(0)) {
    await application.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the authenticated Review resource creates only an exact complete v1 snapshot", async () => {
  const { application, origin } = await startApplication();
  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const setCookie = login.headers.get("set-cookie");
  const session = setCookie.match(/quality_bar_session=[A-Za-z0-9_-]{43}/)[0];
  const csrf = setCookie.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)[1];
  const headers = {
    "content-type": "application/json",
    cookie: `${session}; quality_bar_csrf=${csrf}`,
    origin: "http://127.0.0.1:3000",
    "x-quality-bar-csrf": csrf,
  };

  const created = await fetch(`${origin}/api/v1/reviews`, {
    body: JSON.stringify(reviewRequest()),
    headers,
    method: "POST",
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).active_version.number, 1);

  const rejected = await fetch(`${origin}/api/v1/reviews`, {
    body: JSON.stringify(reviewRequest({ unexpected: true })),
    headers,
    method: "POST",
  });
  assert.equal(rejected.status, 422);
  assert.equal((await rejected.json()).error.code, "review_request_malformed");
  assert.equal(
    application.durableCore.get("SELECT count(*) AS count FROM reviews").count,
    1,
  );
});

test("a sole implementer bearer creates the same Review resource without browser CSRF", async () => {
  const { application, origin } = await startApplication();
  const token = application.implementerTokens.create(
    "a correct operator password",
  );

  const created = await fetch(`${origin}/api/v1/reviews`, {
    body: JSON.stringify(reviewRequest({ name: "Machine HTTP boundaries" })),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).name, "Machine HTTP boundaries");
});

test("an unexpected Review resource failure has an exact owning error", async () => {
  const failure = new Error("exact Review resource failure");
  const { origin } = await startApplication({
    createReviews() {
      return {
        create() {
          throw failure;
        },
      };
    },
  });
  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const setCookie = login.headers.get("set-cookie");
  const session = setCookie.match(/quality_bar_session=[A-Za-z0-9_-]{43}/)[0];
  const csrf = setCookie.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)[1];
  const response = await fetch(`${origin}/api/v1/reviews`, {
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
  const body = await response.json();
  assert.equal(body.error.code, "review_creation_failed");
  assert.equal(body.error.message, "exact Review resource failure");
  assert.match(body.error.request_id, /^[0-9a-f-]{36}$/);
});
