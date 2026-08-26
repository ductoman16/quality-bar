import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createReviewRunClaimService } from "../src/review/review-run-claim.ts";
import { createQueuedReviewRun } from "./review-run-claim-support.ts";

test("a claim write failure is hard storage_unavailable and commits no claim", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-claim-fail-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  await createQueuedReviewRun(core);
  const failureInjectingCore = {
    ...core,
    transaction<Result>(
      callback: (
        transaction: Parameters<typeof core.transaction>[0] extends (
          transaction: infer Transaction,
        ) => unknown
          ? Transaction
          : never,
      ) => Result,
    ): Result {
      return core.transaction((transaction) =>
        callback({
          ...transaction,
          run(
            sql: string,
            ...parameters: Array<import("node:sqlite").SQLInputValue>
          ) {
            if (sql.includes("UPDATE codex_execution_queue")) {
              transaction.run("PRAGMA query_only = ON");
            }
            return transaction.run(sql, ...parameters);
          },
        }),
      );
    },
  };

  assert.throws(
    () =>
      createReviewRunClaimService(failureInjectingCore, {
        createWorkerId: () => "worker-rejected",
        now: () => 1_000,
      }).claimNext(),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "storage_unavailable" &&
      error.message === "SQLite durable write failed",
  );
  core.close();

  const reopened = openDurableCore(databasePath);
  context.after(() => reopened.close());
  assert.deepEqual(
    reopened.get(
      `SELECT worker_id, fencing_token, lease_expires_at
       FROM codex_execution_queue WHERE work_id = ?`,
      "review-run-1",
    ),
    { fencing_token: 0, lease_expires_at: null, worker_id: null },
  );
});
