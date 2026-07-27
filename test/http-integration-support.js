import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "node:test";

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
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-http-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

/**
 * @param {{
 *   createRepositories?: Parameters<typeof createApplication>[0]["createRepositories"],
 *   createReviews?: Parameters<typeof createApplication>[0]["createReviews"]
 * }} [options]
 */
export async function startApplication(options = {}) {
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
    createRepositories: options.createRepositories,
    createReviews: options.createReviews,
    writeLog() {},
  });
  if (!application.durableCore || !application.implementerTokens) {
    throw new Error("http_application_not_ready");
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
    throw new Error("http_server_address_unavailable");
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

/** @param {Response} response */
export async function responseErrorCode(response) {
  const body = /** @type {{error: {code: string}}} */ (await response.json());
  return body.error.code;
}

/** @param {Response} response */
export function sessionCookies(response) {
  const setCookie = response.headers.get("set-cookie");
  const session = setCookie?.match(
    /quality_bar_session=[A-Za-z0-9_-]{43}/,
  )?.[0];
  const csrf = setCookie?.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)?.[1];
  if (!session || !csrf) {
    throw new Error("http_session_cookies_missing");
  }
  return { csrf, session };
}

/**
 * @param {(path: string, init?: RequestInit) => Promise<Response>} request
 */
export async function authenticatedOperatorHeaders(request) {
  const login = await request("/api/v1/session/login", {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { csrf, session } = sessionCookies(login);
  return {
    "content-type": "application/json",
    cookie: `${session}; quality_bar_csrf=${csrf}`,
    origin: "http://127.0.0.1:3000",
    "x-quality-bar-csrf": csrf,
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
