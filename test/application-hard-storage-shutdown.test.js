import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createApplication } from "../src/application.js";
import { unavailableForgejoConnectionService } from "../src/forgejo-connection.js";
import { createUnavailableGitHubConnectionService } from "../src/github-connection.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

test("hard storage failure stops work, terminates Codex, and rejects every product surface", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-storage-shutdown-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  /** @type {string[]} */
  const stopped = [];
  const connectionFailure = new Error("unused connection operation");
  const application = createApplication({
    createCodexRuntime() {
      return {
        async close() {
          stopped.push("codex");
        },
        start() {},
      };
    },
    createForgejoConnections() {
      return {
        ...unavailableForgejoConnectionService(connectionFailure),
        destroy() {
          stopped.push("forgejo");
        },
        requireFreshBaseline() {},
      };
    },
    createGitHubConnections() {
      return {
        ...createUnavailableGitHubConnectionService(connectionFailure),
        destroy() {
          stopped.push("github");
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
  context.after(() => application.close());
  await new Promise((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = application.server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const codexProcess = application.startCodexProcess(() =>
    spawn(process.execPath, [
      join(import.meta.dirname, "../fixtures/test-probes/idle-child.mjs"),
    ]),
  );
  const codexExited = new Promise((resolve) =>
    codexProcess.once("exit", () => resolve(undefined)),
  );

  assert.ok(application.durableCore);
  application.durableCore.run("PRAGMA query_only = ON");
  assert.throws(
    () =>
      application.durableCore?.transaction((transaction) => {
        transaction.run(
          "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
          "write_failure",
          "must-not-exist",
        );
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "storage_unavailable",
  );

  await codexExited;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(application.workerSignal.aborted, true);
  assert.deepEqual(stopped, ["github", "forgejo", "codex"]);
  assert.equal(
    /** @type {{code: string}} */ (application.workerSignal.reason).code,
    "storage_unavailable",
  );
  assert.throws(
    () => application.admitWork(() => assert.fail("work was admitted")),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "storage_unavailable",
  );
  assert.throws(
    () => application.startCodexProcess(() => assert.fail("Codex was started")),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "storage_unavailable",
  );

  for (const path of [
    "/",
    "/?view=system",
    "/api/v1/system",
    "/api/v1?resource=system",
    "/mcp/v1",
    "/mcp/v1?resource=system",
  ]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 503, path);
    assert.equal(
      /** @type {any} */ (await response.json()).error.code,
      "storage_unavailable",
    );
  }
  const live = await fetch(`${origin}/health/live`);
  assert.deepEqual(
    { body: await live.json(), status: live.status },
    { body: { status: "live" }, status: 200 },
  );
  const ready = await fetch(`${origin}/health/ready`);
  assert.deepEqual(
    { body: await ready.json(), status: ready.status },
    {
      body: { error: "storage_unavailable", status: "not_ready" },
      status: 503,
    },
  );
});
