import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "node:test";

import { createApplication } from "../src/application.js";
import { bootstrapOperatorPassword } from "../src/operator-password.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

/** @typedef {ReturnType<typeof createApplication>} Application */
/**
 * @typedef {Application & {
 *   durableCore: NonNullable<Application["durableCore"]>,
 * }} ReadyApplication
 */
/** @type {Application[]} */
const applications = [];
/** @type {string[]} */
const temporaryDirectories = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-session-browser-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

/** @param {string} [origin] */
function validInstallation(origin = "http://127.0.0.1:3000") {
  return {
    externalOrigin: origin,
    freeSpaceReserveBytes: 5 * 1024 ** 3,
    masterKey: Buffer.alloc(32, 7),
    trustedProxyAddresses: origin.startsWith("https:") ? ["127.0.0.1"] : [],
  };
}

/**
 * @param {{
 *   externalOrigin?: string,
 *   now?: () => number,
 *   bootstrap?: boolean,
 * }} [options]
 */
export async function startApplication(options = {}) {
  const application = createApplication({
    createStorageReserve: () => availableStorageReserve,
    databasePath: temporaryDatabasePath(),
    loadInstallation: () => validInstallation(options.externalOrigin),
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    validateTools() {},
    validateCodexAuthentication() {},
    now: options.now,
    writeLog() {},
  });
  applications.push(application);
  if (!application.durableCore) {
    throw new Error("browser_component_application_not_ready");
  }
  const readyApplication = /** @type {ReadyApplication} */ (application);
  if (options.bootstrap !== false) {
    bootstrapOperatorPassword(
      readyApplication.durableCore,
      "a correct operator password",
    );
  }
  await readyApplication.server.listen({ host: "127.0.0.1", port: 0 });
  const address = readyApplication.server.server.address();
  if (!address || typeof address === "string") {
    throw new Error("browser_component_server_address_unavailable");
  }
  return {
    application: readyApplication,
    origin: `http://127.0.0.1:${address.port}`,
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
