import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApplication } from "../src/application.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

test("startup recovers durable Codex work before composing or starting workers", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-startup-recovery-"),
  );
  /** @type {string[]} */
  const order = [];
  const application = createApplication({
    databasePath: join(directory, "quality-bar.sqlite"),
    createStorageReserve: () => availableStorageReserve,
    loadInstallation: () => ({
      externalOrigin: "http://127.0.0.1:3000",
      freeSpaceReserveBytes: 5 * 1024 ** 3,
      masterKey: Buffer.alloc(32, 7),
      trustedProxyAddresses: [],
    }),
    recoverExecutions(durableCore) {
      assert.equal(typeof durableCore?.transaction, "function");
      order.push("recover");
      return { interrupted: 0, queued: 0 };
    },
    createCodexRuntime() {
      order.push("compose");
      return {
        async close() {},
        start() {
          order.push("start");
        },
      };
    },
    validateCodexAuthentication() {},
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    validateTools() {},
    writeLog() {},
  });
  try {
    assert.deepEqual(order, ["recover", "compose", "start"]);
  } finally {
    await application.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
