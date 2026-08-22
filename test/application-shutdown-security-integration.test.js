import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApplication } from "../src/application/application.js";
import { createUnavailableGitHubConnectionService } from "../src/github/github-connection.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

test("shutdown failure logs its owning code without exposing a registered credential", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-shutdown-security-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const secret = "shutdown-owned-credential";
  const failure = Object.assign(
    new Error(`GitHub shutdown failed with token=${secret}`),
    { code: "github_shutdown_failed" },
  );
  /** @type {string[]} */
  const logs = [];
  const application = createApplication({
    createCodexRuntime: () => ({ async close() {}, start() {} }),
    createGitHubConnections(core, options) {
      void core;
      options.registerSecret(secret);
      return {
        ...createUnavailableGitHubConnectionService(new Error("unused")),
        destroy() {
          throw failure;
        },
      };
    },
    createStorageReserve: () => availableStorageReserve,
    databasePath: join(directory, "quality-bar.sqlite3"),
    loadInstallation: () => ({
      externalOrigin: "http://127.0.0.1:3000",
      freeSpaceReserveBytes: 5 * 1024 ** 3,
      masterKey: Buffer.alloc(32, 7),
      trustedProxyAddresses: [],
    }),
    validateCodexAuthentication() {},
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    validateTools() {},
    writeLog(line) {
      logs.push(line);
    },
  });

  await assert.rejects(application.close(), (error) => error === failure);
  assert.doesNotMatch(logs.join(""), new RegExp(secret));
  const shutdownFailure = logs
    .map((line) => JSON.parse(line))
    .find((record) => record.event === "application_shutdown_failed");
  assert.deepEqual(shutdownFailure, {
    component: "application",
    detail: "GitHub shutdown failed with token: [REDACTED]",
    error: "github_shutdown_failed",
    event: "application_shutdown_failed",
    outcome: "failure",
    severity: "error",
    timestamp: shutdownFailure.timestamp,
  });
  application.durableCore?.close();
});
