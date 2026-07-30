import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApplication } from "../src/application.js";
import { unavailableForgejoConnectionService } from "../src/forgejo-connection.js";
import { createUnavailableGitHubConnectionService } from "../src/github-connection.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

test("shutdown stops recurring I/O before waiting for held Codex work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-shutdown-"));
  /** @type {string[]} */
  const order = [];
  /** @type {() => void} */
  let releaseCodex = () => assert.fail("Codex close was not waiting");
  const connectionFailure = new Error("unused connection operation");
  const application = createApplication({
    createCodexRuntime() {
      return {
        close() {
          order.push("codex-drain");
          return new Promise((resolve) => {
            releaseCodex = resolve;
          });
        },
        start() {},
      };
    },
    createForgejoConnections() {
      return {
        ...unavailableForgejoConnectionService(connectionFailure),
        destroy() {
          order.push("forgejo-stop");
        },
        requireFreshBaseline() {},
      };
    },
    createGitHubConnections() {
      return {
        ...createUnavailableGitHubConnectionService(connectionFailure),
        destroy() {
          order.push("github-stop");
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
    writeLog() {},
  });
  try {
    const closing = application.close();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["github-stop", "forgejo-stop", "codex-drain"]);
    releaseCodex();
    await closing;
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
