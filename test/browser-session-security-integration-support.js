import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "node:test";

import { createApplication } from "../src/application.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

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

export function temporaryDatabasePath() {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-session-security-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

/**
 * @param {string} [databasePath]
 * @param {{
 *   externalOrigin?: string,
 *   now?: () => number,
 *   trustedProxyAddresses?: string[],
 * }} [options]
 */
export async function startApplication(
  databasePath = temporaryDatabasePath(),
  {
    externalOrigin = "http://127.0.0.1:3000",
    now,
    trustedProxyAddresses = [],
  } = {},
) {
  const application = createApplication({
    createStorageReserve: () => availableStorageReserve,
    databasePath,
    loadInstallation: () => ({
      externalOrigin,
      freeSpaceReserveBytes: 5 * 1024 ** 3,
      masterKey: Buffer.alloc(32, 7),
      trustedProxyAddresses,
    }),
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    validateTools() {},
    validateCodexAuthentication() {},
    writeLog() {},
    now,
  });
  applications.push(application);
  if (!application.durableCore || !application.implementerTokens) {
    throw new Error("security_integration_application_not_ready");
  }
  const readyApplication = /** @type {ReadyApplication} */ (application);
  await new Promise((resolve, reject) => {
    readyApplication.server.once("error", reject);
    readyApplication.server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = readyApplication.server.address();
  if (!address || typeof address === "string") {
    throw new Error("security_integration_server_address_unavailable");
  }
  return {
    application: readyApplication,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

/** @param {Application} application */
export async function closeApplication(application) {
  const index = applications.indexOf(application);
  if (index === -1) {
    throw new Error("security_integration_application_not_registered");
  }
  await application.close();
  applications.splice(index, 1);
}

afterEach(async () => {
  for (const application of applications.splice(0)) {
    await application.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});
