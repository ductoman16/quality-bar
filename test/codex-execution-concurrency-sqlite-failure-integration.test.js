import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCodexExecutionConcurrencyService } from "../src/codex/codex-execution-concurrency.js";
import { openDurableCore } from "../src/durable/durable-core.js";

test("a concurrency write failure is storage_unavailable and keeps the prior durable value", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-concurrency-fail-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  const failingCore = {
    ...core,
    /**
     * @template Result
     * @param {(transaction: Parameters<typeof core.transaction>[0] extends (transaction: infer Transaction) => unknown ? Transaction : never) => Result} callback
     * @returns {Result}
     */
    transaction(callback) {
      return core.transaction((transaction) =>
        callback({
          ...transaction,
          /**
           * @param {string} sql
           * @param {...import("node:sqlite").SQLInputValue} parameters
           */
          run(sql, ...parameters) {
            if (sql.includes("UPDATE codex_execution_settings")) {
              transaction.run("PRAGMA query_only = ON");
            }
            return transaction.run(sql, ...parameters);
          },
        }),
      );
    },
  };

  assert.throws(
    () => createCodexExecutionConcurrencyService(failingCore).set(4),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "storage_unavailable" &&
      error.message === "SQLite durable write failed",
  );
  core.close();

  const reopened = openDurableCore(databasePath);
  context.after(() => reopened.close());
  assert.equal(createCodexExecutionConcurrencyService(reopened).read(), 1);
});
