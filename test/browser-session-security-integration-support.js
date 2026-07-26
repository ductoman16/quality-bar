import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "node:test";

import { createApplication } from "../src/application.js";

const applications = [];
const temporaryDirectories = [];

export function temporaryDatabasePath() {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-session-security-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

export async function startApplication(
  databasePath = temporaryDatabasePath(),
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
  return {
    application,
    origin: `http://127.0.0.1:${application.server.address().port}`,
  };
}

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
