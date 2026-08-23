import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { createEvaluationService } from "../src/evaluation/evaluation.js";
import { createReviewService } from "../src/review/review.js";
import { assertSupersessionFencesRunningWorker } from "./automatic-evaluation-supersession-support.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

/** @param {string} base @param {string} head */
function changeset(base, head) {
  return {
    base_commit: base.repeat(40),
    head_commit: head.repeat(40),
  };
}

test("a different Forgejo pair supersedes only the target PR's nonterminal work", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-lifecycle-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://forgejo.example/operator/repository.git",
    1,
    1,
  );
  createReviewService(core, {
    createId: () => "review-fact-1",
    now: () => 2,
  }).create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "blocking", instruction: "Review this pair." }],
    description: "Forgejo lifecycle proof",
    name: "Forgejo lifecycle",
  });
  let evaluationId = 0;
  let reviewRunId = 0;
  /** @type {string[]} */
  const signalled = [];
  let timestamp = 10;
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => {
      throw new Error("automatic admission owns acquisition");
    },
    createId: () => `evaluation-${++evaluationId}`,
    createReviewRunId: () => `review-run-${++reviewRunId}`,
    masterKey: Buffer.alloc(32, 7),
    now: () => timestamp++,
    readCodexCapabilityFailure: () => null,
    signalCancellations: (workIds) => signalled.push(...workIds),
    storageReserve: availableStorageReserve,
  });
  /**
   * @param {{base_commit: string, head_commit: string}} pair
   * @param {number} [pullRequestNumber]
   */
  const admit = (pair, pullRequestNumber = 17) =>
    core.transaction((transaction) =>
      evaluations.admitAutomatic(transaction, {
        provider: "forgejo",
        changeset: pair,
        pullRequestNumber,
        repositoryId: "repository-1",
      }),
    );

  const first = admit(changeset("1", "2"));
  first.afterCommit();
  const shared = admit(changeset("1", "2"), 18);
  shared.afterCommit();
  assert.equal(shared.resource.id, "evaluation-1");
  assert.deepEqual(
    core.all(
      `SELECT pull_request_number
         FROM forgejo_automatic_evaluation_pull_requests
        WHERE evaluation_id = 'evaluation-1'
        ORDER BY pull_request_number`,
    ),
    [{ pull_request_number: 17 }, { pull_request_number: 18 }],
  );
  const unrelated = admit(changeset("4", "5"), 19);
  unrelated.afterCommit();
  assert.equal(unrelated.resource.id, "evaluation-2");
  core.run(
    `UPDATE evaluations SET execution_status = 'running'
      WHERE id = 'evaluation-1'`,
  );
  core.run(
    `UPDATE review_runs
        SET execution_status = 'running', started_at = 10
      WHERE id = 'review-run-1'`,
  );
  core.run(
    `UPDATE codex_execution_queue
        SET started_at = 10, worker_id = 'worker-1',
            fencing_token = 1, lease_expires_at = 12000
      WHERE work_id = 'review-run-1'`,
  );

  const second = admit(changeset("1", "3"), 18);

  assert.deepEqual(signalled, []);
  assert.equal(second.resource.id, "evaluation-3");
  assert.deepEqual(
    core.get(
      `SELECT execution_status, cancellation_code, cancellation_detail
         FROM evaluations WHERE id = 'evaluation-1'`,
    ),
    {
      cancellation_code: "cancelled_by_supersession",
      cancellation_detail:
        "Evaluation was superseded by a different pull request Changeset",
      execution_status: "cancelled",
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT execution_status, completed_at
         FROM review_runs WHERE id = 'review-run-1'`,
    ),
    { completed_at: 12, execution_status: "cancelled" },
  );
  assert.deepEqual(
    core.get(
      `SELECT outcome, completed_at
         FROM evaluation_results WHERE evaluation_id = 'evaluation-1'`,
    ),
    { completed_at: 12, outcome: "error" },
  );
  assertSupersessionFencesRunningWorker(core);
  assert.deepEqual(signalled, []);
  second.afterCommit();
  assert.deepEqual(signalled, ["review-run-1"]);

  const returned = admit(changeset("1", "2"), 18);

  assert.equal(returned.resource.id, "evaluation-1");
  assert.equal(
    core.get(
      "SELECT execution_status FROM evaluations WHERE id = 'evaluation-3'",
    )?.execution_status,
    "cancelled",
  );
  assert.equal(
    core.get(
      "SELECT execution_status FROM evaluations WHERE id = 'evaluation-2'",
    )?.execution_status,
    "queued",
  );
  assert.equal(core.get("SELECT count(*) AS count FROM evaluations")?.count, 3);
  returned.afterCommit();
  evaluations.destroy();
  core.close();
});
