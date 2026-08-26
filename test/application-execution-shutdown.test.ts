import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApplication } from "../src/application/application.ts";
import {
  stubUnavailableForgejoConnectionService,
  stubUnavailableGitHubConnectionService,
} from "./service-stubs-support.ts";
import { availableStorageReserve } from "./storage-reserve-support.ts";

test("shutdown stops recurring I/O before waiting for held Codex work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-shutdown-"));
  const order: string[] = [];
  let releaseCodex: () => void = () =>
    assert.fail("Codex close was not waiting");
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
        ...stubUnavailableForgejoConnectionService(connectionFailure),
        destroy() {
          order.push("forgejo-destroy");
        },
        requireFreshBaseline() {},
        stopPolling() {
          order.push("forgejo-stop");
        },
      };
    },
    createGitHubConnections() {
      return {
        ...stubUnavailableGitHubConnectionService(connectionFailure),
        destroy() {
          order.push("github-destroy");
        },
        stopPolling() {
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
    assert.deepEqual(order, ["codex-drain", "github-stop", "forgejo-stop"]);
    releaseCodex();
    await closing;
    assert.deepEqual(order.slice(3), ["github-destroy", "forgejo-destroy"]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("shutdown gates admission, polling advancement, and Codex starts before draining active work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-shutdown-gate-"));
  const codexDrain = Promise.withResolvers<void>();
  let guardedStorageReserve: any;
  const application = createApplication({
    createCodexRuntime(durableCore, dependencies) {
      void durableCore;
      guardedStorageReserve = dependencies.storageReserve;
      return {
        close() {
          for (const transition of [
            () => guardedStorageReserve.assertWorkAdmissionAvailable(),
            () =>
              guardedStorageReserve.assertPollingObservationAdvanceAvailable(),
            () => guardedStorageReserve.preparePollingObservationAdvance(),
            () => guardedStorageReserve.assertCodexStartAvailable(),
          ]) {
            assert.throws(
              transition,
              (error) =>
                error instanceof Error &&
                "code" in error &&
                error.code === "application_shutting_down",
            );
          }
          return codexDrain.promise;
        },
        start() {},
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
    assert.equal(application.workerSignal.aborted, true);
    assert.equal(
      (application.workerSignal.reason as any).code,
      "application_shutting_down",
    );
    assert.throws(
      () => application.admitWork(() => assert.fail("work was admitted")),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "application_shutting_down",
    );
    assert.throws(
      () =>
        application.startCodexProcess(() =>
          assert.fail("new Codex execution started"),
        ),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "application_shutting_down",
    );
    codexDrain.resolve(undefined);
    await closing;
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
