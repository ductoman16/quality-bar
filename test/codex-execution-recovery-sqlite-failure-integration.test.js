import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCodexExecutionClaimService } from "../src/codex-execution-claim.js";
import { recoverCodexExecutions } from "../src/codex-execution-recovery.js";
import { openDurableCore } from "../src/durable-core.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("restart recovery write failure is hard storage_unavailable with no partial state", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-recovery-fail-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite");
  const core = openDurableCore(databasePath);
  await createQueuedReviewRun(core);
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "failed-recovery-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");
  const failureInjectingCore = {
    ...core,
    /**
     * @template Result
     * @param {(transaction: any) => Result} callback
     * @returns {Result}
     */
    transaction(callback) {
      return core.transaction((transaction) =>
        callback({
          ...transaction,
          /** @param {string} sql @param {import("node:sqlite").SQLInputValue[]} parameters */
          run(sql, ...parameters) {
            if (sql.includes("UPDATE review_runs")) {
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
      recoverCodexExecutions(failureInjectingCore, {
        now: () => 30,
      }),
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
      `SELECT execution_status, completed_at, error_code
       FROM review_runs WHERE id = 'review-run-1'`,
    ),
    {
      completed_at: null,
      error_code: null,
      execution_status: "running",
    },
  );
  assert.equal(
    reopened.get(
      `SELECT recovered_at FROM codex_execution_queue
       WHERE work_id = 'review-run-1'`,
    )?.recovered_at,
    null,
  );
  assert.equal(
    reopened.get("SELECT count(*) AS count FROM evaluation_results")?.count,
    0,
  );
});
