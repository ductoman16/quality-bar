import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { createApplication } from "../src/application.js";
import { bootstrapOperatorPassword } from "../src/operator-password.js";

const temporaryDirectories = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-browser-assets-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

function browserElement(properties = {}) {
  const listeners = new Map();
  return {
    ...properties,
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    listener(name) {
      return listeners.get(name);
    },
    querySelectorAll() {
      return [];
    },
    replaceChildren() {},
    showModal() {},
    close() {},
  };
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
    writeLog() {},
    readBrowserAsset: options.readBrowserAsset,
  });
  bootstrapOperatorPassword(
    application.durableCore,
    "a correct operator password",
  );
  await new Promise((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    application,
    origin: `http://127.0.0.1:${application.server.address().port}`,
  };
}

async function servedAsset(origin, path, headers) {
  const response = await fetch(`${origin}${path}`, { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/javascript/);
  return response.text();
}

function configurationFrom(page) {
  const match = page.match(
    /<script id="browser-configuration" type="application\/json">([^<]*)<\/script>/,
  );
  assert.ok(
    match,
    "the page must transfer browser configuration as inert JSON",
  );
  return match[1];
}

test("browser pages serve and execute their exact maintained same-origin assets", async (context) => {
  const { application, origin } = await startApplication();
  context.after(async () => {
    await application.close();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  const loginPage = await (
    await fetch(`${origin}/?return_to=%2Freviews`)
  ).text();
  assert.match(loginPage, /<script src="\/assets\/login\.js"><\/script>/);
  assert.doesNotMatch(loginPage, /const intendedDestination/);
  const loginSource = await servedAsset(origin, "/assets/login.js");
  const loginForm = browserElement();
  const loginError = browserElement({ hidden: true });
  const loginElements = new Map([
    [
      "browser-configuration",
      browserElement({
        textContent: configurationFrom(loginPage),
        type: "application/json",
      }),
    ],
    ["error", loginError],
    ["login-form", loginForm],
    ["password", browserElement({ value: "a correct operator password" })],
  ]);
  const loginRequests = [];
  let loginDestination;
  runInNewContext(loginSource, {
    URL,
    document: {
      getElementById(id) {
        return loginElements.get(id) ?? null;
      },
    },
    fetch: async (path, options) => {
      loginRequests.push({ options, path });
      return { ok: true };
    },
    location: {
      assign(value) {
        loginDestination = value;
      },
    },
  });
  await loginForm.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(loginRequests)), [
    {
      options: {
        body: JSON.stringify({ password: "a correct operator password" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      path: "/api/v1/session/login",
    },
  ]);
  assert.equal(loginDestination, "/reviews");
  assert.equal(loginError.hidden, true);

  assert.throws(
    () =>
      runInNewContext(loginSource, {
        URL,
        document: {
          getElementById: () =>
            browserElement({ textContent: "{}", type: "application/json" }),
        },
      }),
    /browser_configuration_invalid/,
  );
  assert.throws(
    () =>
      runInNewContext(loginSource, {
        URL,
        document: {
          getElementById: () =>
            browserElement({
              textContent: JSON.stringify({
                intendedDestination: "/\\\\attacker.example",
              }),
              type: "application/json",
            }),
        },
      }),
    /browser_configuration_invalid/,
  );

  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const unauthenticatedOperatorAsset = await fetch(
    `${origin}/assets/operator.js`,
  );
  assert.equal(unauthenticatedOperatorAsset.status, 401);
  assert.equal(
    (await unauthenticatedOperatorAsset.json()).error.code,
    "authentication_required",
  );
  const mixedCredentialOperatorAsset = await fetch(
    `${origin}/assets/operator.js`,
    { headers: { authorization: "Bearer ignored", cookie } },
  );
  assert.equal(mixedCredentialOperatorAsset.status, 401);
  assert.equal(
    (await mixedCredentialOperatorAsset.json()).error.code,
    "authentication_ambiguous",
  );

  const operatorPage = await (
    await fetch(`${origin}/`, { headers: { cookie } })
  ).text();
  assert.match(operatorPage, /<script src="\/assets\/operator\.js"><\/script>/);
  assert.match(
    operatorPage,
    /<script id="browser-configuration" type="application\/json">\{"csrfCookieName":"quality_bar_csrf"\}<\/script>/,
  );
  assert.doesNotMatch(operatorPage, /returnToLoginAfterAuthenticationFailure/);
  const operatorSource = await servedAsset(origin, "/assets/operator.js", {
    cookie,
  });
  const operatorElements = new Map(
    [
      "error",
      "password-change-form",
      "session-revocation-form",
      "implementer-token-create-form",
      "implementer-token-rotate-form",
      "implementer-token-revoke-form",
      "implementer-token-reveal",
      "implementer-token-reveal-close",
      "implementer-token-value",
      "logout",
    ].map((id) => [id, browserElement()]),
  );
  operatorElements.set(
    "browser-configuration",
    browserElement({
      textContent: JSON.stringify({
        csrfCookieName: "quality_bar_configured_csrf",
      }),
      type: "application/json",
    }),
  );
  const documentListeners = new Map();
  const operatorRequests = [];
  const operatorDestinations = [];
  let logoutAttempts = 0;
  runInNewContext(operatorSource, {
    Date,
    document: {
      addEventListener(name, listener) {
        documentListeners.set(name, listener);
      },
      cookie: "quality_bar_configured_csrf=csrf-token",
      getElementById(id) {
        return operatorElements.get(id) ?? null;
      },
      querySelectorAll() {
        return [];
      },
    },
    fetch: async (path, options) => {
      operatorRequests.push({ options, path });
      if (path === "/api/v1/system") {
        return {
          ok: true,
          async json() {
            return {
              bootstrap: { status: "ready" },
              browser_sessions: { active_count: 1 },
              codex: { catalog: { models: [] }, status: "available" },
              durable_core: { status: "ready" },
              implementer_token: { status: "revoked" },
            };
          },
        };
      }
      logoutAttempts += 1;
      return logoutAttempts === 1
        ? {
            ok: false,
            status: 401,
            async json() {
              return { error: { code: "authentication_required" } };
            },
          }
        : {
            ok: false,
            status: 500,
            async json() {
              return { error: { message: "exact logout failure" } };
            },
          };
    },
    location: {
      assign(value) {
        operatorDestinations.push(value);
      },
      pathname: "/",
      search: "",
    },
    window: {
      confirm() {
        return false;
      },
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    operatorRequests.map((request) => request.path),
    ["/api/v1/system"],
  );
  assert.ok(documentListeners.has("keydown"));
  assert.ok(documentListeners.has("pointerdown"));
  await operatorElements.get("logout").listener("click")();
  assert.deepEqual(JSON.parse(JSON.stringify(operatorRequests[1])), {
    options: {
      headers: { "x-quality-bar-csrf": "csrf-token" },
      method: "POST",
    },
    path: "/api/v1/session/logout",
  });
  assert.deepEqual(operatorDestinations, ["/?return_to=%2F"]);
  await operatorElements.get("logout").listener("click")();
  assert.equal(operatorElements.get("error").hidden, false);
  assert.equal(
    operatorElements.get("error").textContent,
    "exact logout failure",
  );

  const missingAsset = await fetch(`${origin}/assets/not-maintained.js`);
  assert.equal(missingAsset.status, 404);
  assert.equal(
    (await missingAsset.json()).error.code,
    "browser_asset_not_found",
  );
});

test("an unavailable browser asset has one exact owning failure and no fallback", async (context) => {
  const unavailable = new Error("Browser asset is unavailable");
  unavailable.code = "browser_asset_unavailable";
  const { application, origin } = await startApplication({
    readBrowserAsset() {
      throw unavailable;
    },
  });
  context.after(async () => {
    await application.close();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  const response = await fetch(`${origin}/assets/login.js`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, "browser_asset_unavailable");
  assert.equal(body.error.message, "Browser asset is unavailable");
});
