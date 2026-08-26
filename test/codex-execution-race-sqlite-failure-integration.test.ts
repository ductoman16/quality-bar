import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createReviewRunClaimService } from "../src/review/review-run-claim.ts";
import { createReviewRunResultService } from "../src/review/review-run-result.ts";
import { createWaiverAdjudicationClaimService } from "../src/waiver/waiver-adjudication-claim.ts";
import { createWaiverAdjudicationResultService } from "../src/waiver/waiver-adjudication-result-service.ts";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.ts";
import { createQueuedReviewRun } from "./review-run-claim-support.ts";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.ts";

test("a Review Run submission write failure after a Result fact stores no partial Result", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-race-write-fail-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  await createQueuedReviewRun(core);
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "write-failure-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");
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
            if (sql.includes("INSERT INTO findings")) {
              transaction.run("PRAGMA query_only = ON");
            }
            return transaction.run(sql, ...parameters);
          },
        }),
      );
    },
  };
  const criterion = core.get(
    `SELECT criterion_id FROM review_version_criteria
     WHERE review_version_id = (
       SELECT review_version_id FROM review_runs WHERE id = 'review-run-1'
     )`,
  );
  assert.ok(criterion);
  assert.throws(
    () =>
      createReviewRunResultService(failureInjectingCore, {
        now: () => 30,
      }).prepare(
        claim,
        {
          criterion_results: [
            {
              criterion_id: criterion.criterion_id,
              findings: [
                {
                  evidence: "The exact stale fact requires review.",
                  location: { kind: "changeset" },
                  remediation: "Replace the stale fact.",
                },
              ],
              outcome: "triggered",
            },
          ],
        },
        [],
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "storage_unavailable" &&
      error.message === "SQLite durable write failed",
  );
  core.close();
  const reopened = openDurableCore(databasePath);
  context.after(() => reopened.close());
  assert.equal(
    reopened.get("SELECT count(*) AS count FROM criterion_results")?.count,
    0,
  );
  assert.deepEqual(
    reopened.get("SELECT execution_status, completed_at FROM review_runs"),
    { completed_at: null, execution_status: "running" },
  );
});

test("a Waiver Adjudication write failure after a Decision stores no partial Decisions", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-waiver-write-fail-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  seedCompletedEvaluation(core);
  const requestIds = ["request-1", "request-2"];
  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-1",
    createRequestId: () => requestIds.shift() ?? assert.fail("missing request"),
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "waiver-write-failure",
    request: {
      requests: [
        { finding_id: "finding-1", rationale: "First exact exception." },
        { finding_id: "finding-2", rationale: "Second exact exception." },
      ],
    },
  });
  const claims = createWaiverAdjudicationClaimService(core, {
    createWorkerId: () => "waiver-write-failure-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");
  let writes = 0;
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
            if (
              sql.includes("INSERT INTO waiver_decisions") &&
              ++writes === 2
            ) {
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
      createWaiverAdjudicationResultService(failureInjectingCore, {
        createDecisionId: (() => {
          let id = 0;
          return () => `decision-${++id}`;
        })(),
        now: () => 30,
      }).prepare(claim, {
        decisions: [
          {
            explanation: "The first frozen fact permits this exception.",
            outcome: "accepted",
            request_id: "request-1",
          },
          {
            explanation: "The second frozen fact denies this exception.",
            outcome: "denied",
            request_id: "request-2",
          },
        ],
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
  assert.equal(
    reopened.get("SELECT count(*) AS count FROM waiver_decisions")?.count,
    0,
  );
  assert.deepEqual(
    reopened.get(
      "SELECT execution_status, completed_at FROM waiver_adjudications",
    ),
    { completed_at: null, execution_status: "running" },
  );
});
