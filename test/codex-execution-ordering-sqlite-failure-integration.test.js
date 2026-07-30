import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCodexExecutionClaimService } from "../src/codex-execution-claim.js";
import { openDurableCore } from "../src/durable-core.js";
import { seedQueuedCodexExecutionKinds } from "./codex-execution-ordering-support.js";

test("shared claim storage failure keeps both kinds queued with no inferred result", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-order-fail-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: 10,
    reviewRunReadyAt: 10,
  });
  const failureInjectingCore = {
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
      createCodexExecutionClaimService(failureInjectingCore, {
        createWorkerId: () => "rejected-worker",
        now: () => 10,
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
    reopened.all(
      `SELECT work_id, ready_at, worker_id, fencing_token
       FROM codex_execution_queue ORDER BY ready_at, work_id`,
    ),
    [
      {
        fencing_token: 0,
        ready_at: 10,
        work_id: "adjudication-a",
        worker_id: null,
      },
      {
        fencing_token: 0,
        ready_at: 10,
        work_id: "review-run-z",
        worker_id: null,
      },
    ],
  );
  assert.equal(
    reopened.get("SELECT count(*) AS count FROM waiver_decisions")?.count,
    0,
  );
  assert.equal(
    reopened.get(
      "SELECT count(*) AS count FROM evaluation_results WHERE evaluation_id = 'evaluation-queued'",
    )?.count,
    0,
  );
});
