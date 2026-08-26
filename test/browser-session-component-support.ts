import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "node:test";

import { createApplication } from "../src/application/application.ts";
import { bootstrapOperatorPassword } from "../src/operator/operator-password.ts";
import { availableStorageReserve } from "./storage-reserve-support.ts";

export type Application = ReturnType<typeof createApplication>;

export type ReadyApplication = Application & {
  durableCore: NonNullable<Application["durableCore"]>;
};
const applications: Application[] = [];
const temporaryDirectories: string[] = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-session-browser-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

function validInstallation(origin: string = "http://127.0.0.1:3000") {
  return {
    externalOrigin: origin,
    freeSpaceReserveBytes: 5 * 1024 ** 3,
    masterKey: Buffer.alloc(32, 7),
    trustedProxyAddresses: origin.startsWith("https:") ? ["127.0.0.1"] : [],
  };
}

export async function startApplication(
  options: {
    externalOrigin?: string;
    now?: () => number;
    bootstrap?: boolean;
  } = {},
) {
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
  const readyApplication = application as ReadyApplication;
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
