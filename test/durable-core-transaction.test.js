import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";

const temporaryDirectories = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-sqlite-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("rejects asynchronous transaction callbacks without committing partial facts", async () => {
  const core = openDurableCore(temporaryDatabasePath());
  let callbackWasInvoked = false;

  assert.throws(
    () =>
      core.transaction(async (transaction) => {
        callbackWasInvoked = true;
        await Promise.resolve();
        transaction.run(
          "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
          "async_partial_fact",
          "must-not-exist",
        );
      }),
    (error) => {
      assert.equal(error.code, "asynchronous_transaction_unsupported");
      assert.equal(
        error.message,
        "SQLite transaction callback must be synchronous",
      );
      return true;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(callbackWasInvoked, false);
  assert.equal(
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      "async_partial_fact",
    ),
    undefined,
  );

  core.close();
});

test("preserves a rejected thenable on the exact asynchronous transaction error", async () => {
  const core = openDurableCore(temporaryDatabasePath());
  const callbackFailure = new Error("callback rejected");
  let transactionError;

  try {
    core.transaction(() => Promise.reject(callbackFailure));
  } catch (error) {
    transactionError = error;
  }
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(transactionError.code, "asynchronous_transaction_unsupported");
  assert.equal(
    transactionError.message,
    "SQLite transaction callback must be synchronous",
  );
  assert.equal(transactionError.cause, callbackFailure);

  core.close();
});
