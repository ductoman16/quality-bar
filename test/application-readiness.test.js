import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createApplication } from "../src/application.js";

const applications = [];
const temporaryDirectories = [];

async function startApplication(databasePath) {
  const application = createApplication({
    databasePath,
    writeLog() {},
  });
  await new Promise((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = application.server.address();
  applications.push(application);
  return {
    application,
    origin: `http://127.0.0.1:${port}`,
  };
}

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-application-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

afterEach(async () => {
  for (const application of applications.splice(0)) {
    await application.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("SQLite startup failure keeps liveness distinct from exact not-ready state", async () => {
  const { origin } = await startApplication(":memory:");

  const liveResponse = await fetch(`${origin}/health/live`);
  assert.equal(liveResponse.status, 200);
  assert.deepEqual(await liveResponse.json(), { status: "live" });

  const readyResponse = await fetch(`${origin}/health/ready`);
  assert.equal(readyResponse.status, 503);
  assert.deepEqual(await readyResponse.json(), {
    error: "wal_unavailable",
    status: "not_ready",
  });
});

test("hard storage failure stops work, terminates Codex, and rejects every product surface", async () => {
  const { application, origin } = await startApplication(
    temporaryDatabasePath(),
  );
  const codexProcess = spawn(process.execPath, [
    "--eval",
    "setInterval(() => {}, 1_000)",
  ]);
  application.registerCodexProcess(codexProcess);
  const codexExited = new Promise((resolve) =>
    codexProcess.once("exit", resolve),
  );

  const readyResponse = await fetch(`${origin}/health/ready`);
  assert.equal(readyResponse.status, 200);
  assert.deepEqual(await readyResponse.json(), { status: "ready" });

  application.durableCore.run("PRAGMA query_only = ON");
  assert.throws(
    () =>
      application.durableCore.transaction((transaction) => {
        transaction.run(
          "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
          "write_failure",
          "must-not-exist",
        );
      }),
    (error) => error.code === "storage_unavailable",
  );

  await codexExited;
  assert.equal(application.workerSignal.aborted, true);
  assert.equal(application.workerSignal.reason.code, "storage_unavailable");

  for (const path of ["/", "/api/v1/system", "/mcp/v1"]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 503, path);
    assert.deepEqual(await response.json(), {
      error: "storage_unavailable",
    });
  }

  const liveAfterFailure = await fetch(`${origin}/health/live`);
  assert.equal(liveAfterFailure.status, 200);
  assert.deepEqual(await liveAfterFailure.json(), { status: "live" });

  const readyAfterFailure = await fetch(`${origin}/health/ready`);
  assert.equal(readyAfterFailure.status, 503);
  assert.deepEqual(await readyAfterFailure.json(), {
    error: "storage_unavailable",
    status: "not_ready",
  });
});
