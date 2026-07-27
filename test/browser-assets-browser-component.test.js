import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Script } from "node:vm";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { createApplication } from "../src/application.js";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import { bootstrapOperatorPassword } from "../src/operator-password.js";

/**
 * @typedef {{
 *   hidden?: boolean,
 *   textContent?: string,
 *   type?: string,
 *   value?: string,
 *   addEventListener: (
 *     name: string,
 *     listener: (event?: {preventDefault(): void}) => unknown
 *   ) => void,
 *   listener: (
 *     name: string
 *   ) => (event?: {preventDefault(): void}) => unknown,
 *   querySelectorAll: () => BrowserElement[],
 *   replaceChildren: () => void,
 *   showModal: () => void,
 *   close: () => void,
 * }} BrowserElement
 */
/** @type {string[]} */
const temporaryDirectories = [];
const repositoryRoot = resolve(import.meta.dirname, "..");

/** @param {string} source @param {object} context */
function runLoginInNewContext(source, context) {
  return executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/login.js",
    source,
    context,
  );
}

/** @param {string} source @param {object} context */
function runOperatorInNewContext(source, context) {
  return executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/operator.js",
    source,
    context,
  );
}

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-browser-assets-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

/** @param {Partial<BrowserElement>} [properties] @returns {BrowserElement} */
function browserElement(properties = {}) {
  /** @type {Map<string, (event?: {preventDefault(): void}) => unknown>} */
  const listeners = new Map();
  return {
    ...properties,
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    listener(name) {
      const listener = listeners.get(name);
      if (!listener) {
        throw new Error(`browser_component_listener_missing: ${name}`);
      }
      return listener;
    },
    querySelectorAll() {
      return [];
    },
    replaceChildren() {},
    showModal() {},
    close() {},
  };
}

test("the Reviews page composes its exact classic scripts and owns metadata validation", () => {
  assert.doesNotThrow(
    () =>
      new Script(
        [
          readBrowserAsset("/assets/operator.js"),
          readBrowserAsset("/assets/review-create.js"),
          readBrowserAsset("/assets/review-metadata.js"),
        ].join("\n"),
      ),
  );
  const page = operatorPage({ view: "reviews" });
  assert.match(page, /aria-required="true" id="review-metadata-name"/);
  assert.match(page, /aria-required="true" id="review-metadata-description"/);
  assert.doesNotMatch(page, /id="review-metadata-name" required/);
  assert.doesNotMatch(page, /id="review-metadata-description" required/);
});

/** @param {{readBrowserAsset?: (path: string) => string}} [options] */
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
    writeLog() {},
    readBrowserAsset: options.readBrowserAsset,
  });
  if (!application.durableCore) {
    throw new Error("browser_asset_application_not_ready");
  }
  bootstrapOperatorPassword(
    application.durableCore,
    "a correct operator password",
  );
  await new Promise((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = application.server.address();
  if (!address || typeof address === "string") {
    throw new Error("browser_asset_server_address_unavailable");
  }
  return {
    application,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

/**
 * @param {string} origin
 * @param {string} path
 * @param {Record<string, string>} [headers]
 */
async function servedAsset(origin, path, headers) {
  const response = await fetch(`${origin}${path}`, { headers });
  assert.equal(response.status, 200);
  const contentType = response.headers.get("content-type");
  assert.ok(contentType);
  assert.match(contentType, /^text\/javascript/);
  return response.text();
}

/** @param {string} page */
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
  /** @type {{path: string, options: object}[]} */
  const loginRequests = [];
  let loginDestination;
  runLoginInNewContext(loginSource, {
    URL,
    document: {
      /** @param {string} id */
      getElementById(id) {
        return loginElements.get(id) ?? null;
      },
    },
    /** @param {string} path @param {object} options */
    fetch: async (path, options) => {
      loginRequests.push({ options, path });
      return { ok: true };
    },
    location: {
      /** @param {string} value */
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
      runLoginInNewContext(loginSource, {
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
      runLoginInNewContext(loginSource, {
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
  const setCookie = login.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("browser_component_login_cookie_missing");
  }
  const cookie = setCookie.split(";", 1)[0];
  const unauthenticatedOperatorAsset = await fetch(
    `${origin}/assets/operator.js`,
  );
  assert.equal(unauthenticatedOperatorAsset.status, 401);
  assert.equal(
    /** @type {{error: {code: string}}} */ (
      await unauthenticatedOperatorAsset.json()
    ).error.code,
    "authentication_required",
  );
  const mixedCredentialOperatorAsset = await fetch(
    `${origin}/assets/operator.js`,
    { headers: { authorization: "Bearer ignored", cookie } },
  );
  assert.equal(mixedCredentialOperatorAsset.status, 401);
  assert.equal(
    /** @type {{error: {code: string}}} */ (
      await mixedCredentialOperatorAsset.json()
    ).error.code,
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
  /** @type {Map<string, (event?: object) => unknown>} */
  const documentListeners = new Map();
  /** @type {{path: string, options: object}[]} */
  const operatorRequests = [];
  /** @type {string[]} */
  const operatorDestinations = [];
  let logoutAttempts = 0;
  runOperatorInNewContext(operatorSource, {
    Date,
    document: {
      /** @param {string} name @param {(event?: object) => unknown} listener */
      addEventListener(name, listener) {
        documentListeners.set(name, listener);
      },
      cookie: "quality_bar_configured_csrf=csrf-token",
      /** @param {string} id */
      getElementById(id) {
        return operatorElements.get(id) ?? null;
      },
      querySelectorAll() {
        return [];
      },
    },
    /** @param {string} path @param {object} options */
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
      /** @param {string} value */
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
  const logout = operatorElements.get("logout");
  const errorElement = operatorElements.get("error");
  if (!logout || !errorElement) {
    throw new Error("browser_component_operator_elements_missing");
  }
  await logout.listener("click")();
  assert.deepEqual(JSON.parse(JSON.stringify(operatorRequests[1])), {
    options: {
      headers: { "x-quality-bar-csrf": "csrf-token" },
      method: "POST",
    },
    path: "/api/v1/session/logout",
  });
  assert.deepEqual(operatorDestinations, ["/?return_to=%2F"]);
  await logout.listener("click")();
  assert.equal(errorElement.hidden, false);
  assert.equal(errorElement.textContent, "exact logout failure");

  const missingAsset = await fetch(`${origin}/assets/not-maintained.js`);
  assert.equal(missingAsset.status, 404);
  assert.equal(
    /** @type {{error: {code: string}}} */ (await missingAsset.json()).error
      .code,
    "browser_asset_not_found",
  );
});

test("an unavailable browser asset has one exact owning failure and no fallback", async (context) => {
  const unavailable = Object.assign(new Error("Browser asset is unavailable"), {
    code: "browser_asset_unavailable",
  });
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
  const body = /** @type {{error: {code: string, message: string}}} */ (
    await response.json()
  );
  assert.equal(body.error.code, "browser_asset_unavailable");
  assert.equal(body.error.message, "Browser asset is unavailable");
});
