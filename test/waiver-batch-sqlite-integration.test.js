import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDurableCore } from "../src/durable-core.js";
import { createCodexExecutionClaimService } from "../src/codex-execution-claim.js";
import { createWaiverBatchService } from "../src/waiver-batch.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";
import { prepareDeniedWaiverRequest } from "./support/waiver-request-lifecycle.js";

test("one transaction creates every immutable Request and its queued Adjudication", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core);
    const requestIds = ["request-1", "request-2"];
    const service = createWaiverBatchService(core, {
      createAdjudicationId: () => "adjudication-1",
      createRequestId: () => requestIds.shift() ?? assert.fail("missing id"),
      now: () => 1_753_800_000_000,
      readCodexCapabilityFailure: () => null,
      storageReserve: { assertWorkAdmissionAvailable() {} },
    });
    const accepted = service.submit({
      channel: "implementer_token",
      evaluationId: "evaluation-1",
      idempotencyKey: "batch-key",
      request: {
        requests: [
          {
            finding_id: "finding-2",
            rationale: "Generated output is retained.",
          },
          {
            finding_id: "finding-1",
            rationale: "This endpoint is intentionally internal.",
          },
        ],
      },
    });

    assert.equal(accepted.status, 201);
    assert.deepEqual(
      accepted.resource.requests.map(
        (/** @type {{finding_id: string}} */ { finding_id }) => finding_id,
      ),
      ["finding-1", "finding-2"],
    );
    assert.equal(accepted.resource.adjudication.execution_status, "queued");
    const sharedClaim = createCodexExecutionClaimService(core, {
      createWorkerId: () => "shared-worker",
      now: () => 1_753_800_000_001,
    }).claimNext();
    assert.equal(sharedClaim?.workId, "adjudication-1");
    assert.equal(sharedClaim?.workKind, "waiver_adjudication");
    assert.deepEqual(
      core.get(
        "SELECT work_kind, work_id FROM codex_execution_queue WHERE work_id = ?",
        "adjudication-1",
      ),
      { work_id: "adjudication-1", work_kind: "waiver_adjudication" },
    );
    assert.throws(
      () =>
        core.run(
          "UPDATE waiver_requests SET rationale = 'changed' WHERE id = 'request-1'",
        ),
      /waiver_request_immutable/,
    );
    assert.deepEqual(
      service.submit({
        channel: "implementer_token",
        evaluationId: "evaluation-1",
        idempotencyKey: "batch-key",
        request: {
          requests: [
            {
              finding_id: "finding-1",
              rationale: "This endpoint is intentionally internal.",
            },
            {
              finding_id: "finding-2",
              rationale: "Generated output is retained.",
            },
          ],
        },
      }),
      accepted,
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("durable waiver identities cannot cross Evaluations and one Request may be recovered later", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-identity-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core);
    core.run(
      "INSERT INTO evaluations (id, repository_id, provenance, base_selector_type, base_selector_value, head_selector_type, head_selector_value, base_commit, head_commit, execution_status, applicability_sealed_at, created_at, completed_at) VALUES ('evaluation-2', 'repository-1', 'explicit', 'commit', ?, 'commit', ?, ?, ?, 'completed', NULL, 3, 4)",
      "c".repeat(40),
      "d".repeat(40),
      "c".repeat(40),
      "d".repeat(40),
    );
    core.run(
      "UPDATE evaluations SET applicability_sealed_at = 3 WHERE id = 'evaluation-2'",
    );
    assert.throws(
      () =>
        core.run(
          "INSERT INTO waiver_requests (id, evaluation_id, finding_id, rationale, requester_channel, created_at) VALUES ('cross-request', 'evaluation-2', 'finding-1', 'Contradictory', 'browser_session', 3)",
        ),
      /waiver_request_evaluation_invalid/,
    );
    core.run(
      "INSERT INTO waiver_requests (id, evaluation_id, finding_id, rationale, requester_channel, created_at) VALUES ('recoverable-request', 'evaluation-1', 'finding-1', 'Recover this request', 'browser_session', 3)",
    );
    for (const [id, status] of [
      ["failed-adjudication", "failed"],
      ["recovery-adjudication", "queued"],
    ]) {
      core.run(
        "INSERT INTO waiver_adjudications (id, evaluation_id, base_commit, head_commit, model, reasoning_effort, service_tier, execution_status, created_at, error_code, error_detail) VALUES (?, 'evaluation-1', ?, ?, 'gpt-5.6-terra', 'high', 'standard', ?, 3, ?, ?)",
        id,
        "a".repeat(40),
        "b".repeat(40),
        status,
        status === "failed" ? "codex_process_failed" : null,
        status === "failed" ? "Codex process failed" : null,
      );
      core.run(
        "INSERT INTO waiver_adjudication_requests (waiver_adjudication_id, waiver_request_id, position) VALUES (?, 'recoverable-request', 1)",
        id,
      );
    }
    core.run(
      "INSERT INTO waiver_adjudications (id, evaluation_id, base_commit, head_commit, model, reasoning_effort, service_tier, execution_status, created_at, error_code, error_detail) VALUES ('cross-adjudication', 'evaluation-2', ?, ?, 'gpt-5.6-terra', 'high', 'standard', 'failed', 3, 'codex_process_failed', 'Codex process failed')",
      "c".repeat(40),
      "d".repeat(40),
    );
    assert.throws(
      () =>
        core.run(
          "INSERT INTO waiver_adjudication_requests (waiver_adjudication_id, waiver_request_id, position) VALUES ('cross-adjudication', 'recoverable-request', 1)",
        ),
      /waiver_adjudication_request_evaluation_invalid/,
    );
    core.run(
      "INSERT INTO codex_execution_queue (work_id, work_kind, ready_at, accepted_at) VALUES ('recovery-adjudication', 'waiver_adjudication', 3, 3)",
    );
    assert.throws(
      () =>
        core.run(
          "DELETE FROM waiver_adjudications WHERE id = 'recovery-adjudication'",
        ),
      /codex_execution_queue_reference_in_use/,
    );
    core.run(
      "INSERT INTO review_runs (id, evaluation_id, review_id, review_version_id, execution_status, created_at) VALUES ('guarded-run', 'evaluation-2', 'review-1', 'version-1', 'queued', 3)",
    );
    core.run(
      "INSERT INTO codex_execution_queue (work_id, work_kind, ready_at, accepted_at) VALUES ('guarded-run', 'review_run', 3, 3)",
    );
    assert.throws(
      () => core.run("DELETE FROM review_runs WHERE id = 'guarded-run'"),
      /codex_execution_queue_reference_in_use/,
    );
    assert.throws(
      () =>
        core.run(
          "UPDATE review_runs SET id = 'orphaned-run' WHERE id = 'guarded-run'",
        ),
      /review_run_identity_immutable/,
    );
    assert.deepEqual(
      core.get(
        "SELECT work_id, work_kind FROM codex_execution_queue WHERE work_id = 'guarded-run'",
      ),
      { work_id: "guarded-run", work_kind: "review_run" },
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("one invalid Finding rolls back the whole batch and its key", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core);
    const service = createWaiverBatchService(core, {
      createAdjudicationId: () => "adjudication-invalid",
      createRequestId: () => "request-invalid",
      now: () => 1_753_800_000_000,
      readCodexCapabilityFailure: () => null,
      storageReserve: { assertWorkAdmissionAvailable() {} },
    });
    assert.throws(
      () =>
        service.submit({
          channel: "browser_session",
          evaluationId: "evaluation-1",
          idempotencyKey: "reusable-key",
          request: {
            requests: [
              { finding_id: "finding-1", rationale: "Specific reason" },
              { finding_id: "finding-blocking", rationale: "Invalid reason" },
            ],
          },
        }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "waiver_finding_ineligible",
    );
    assert.equal(
      core.get("SELECT count(*) AS count FROM waiver_requests")?.count,
      0,
    );
    assert.equal(
      core.get("SELECT count(*) AS count FROM waiver_batch_idempotency")?.count,
      0,
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

/** @type {{code: string, name: string, prepare: (core: any) => void, evaluationId: string}[]} */
const rejectionScenarios = [
  {
    code: "waiver_request_duplicate",
    name: "unchanged prior rationale",
    prepare(core) {
      prepareDeniedWaiverRequest(core, 1, "Scenario-specific reason");
    },
    evaluationId: "evaluation-1",
  },
  {
    code: "codex_model_unsupported",
    name: "obsolete Waiver Adjudicator Configuration",
    prepare(core) {
      core.run(
        "UPDATE waiver_adjudicator_configuration SET model = 'obsolete-model'",
      );
    },
    evaluationId: "evaluation-1",
  },
  {
    code: "waiver_cross_evaluation",
    name: "cross-Evaluation Finding",
    prepare(core) {
      core.run(
        "INSERT INTO evaluations (id, repository_id, provenance, base_selector_type, base_selector_value, head_selector_type, head_selector_value, base_commit, head_commit, execution_status, applicability_sealed_at, created_at, completed_at) VALUES ('evaluation-2', 'repository-1', 'explicit', 'commit', ?, 'commit', ?, ?, ?, 'completed', NULL, 3, 4)",
        "c".repeat(40),
        "d".repeat(40),
        "c".repeat(40),
        "d".repeat(40),
      );
      core.run(
        "UPDATE evaluations SET applicability_sealed_at = 3 WHERE id = 'evaluation-2'",
      );
      core.run(
        "INSERT INTO evaluation_results (evaluation_id, outcome, completed_at) VALUES ('evaluation-2', 'clear', 4)",
      );
    },
    evaluationId: "evaluation-2",
  },
  {
    code: "waiver_request_limit_reached",
    name: "Finding request capacity",
    prepare(core) {
      for (let index = 1; index <= 3; index += 1) {
        prepareDeniedWaiverRequest(core, index, `Prior rationale ${index}`);
      }
    },
    evaluationId: "evaluation-1",
  },
  {
    code: "waiver_adjudication_active",
    name: "active Adjudication",
    prepare(core) {
      core.run(
        "INSERT INTO waiver_adjudications (id, evaluation_id, base_commit, head_commit, model, reasoning_effort, service_tier, execution_status, created_at) VALUES ('active-adjudication', 'evaluation-1', ?, ?, 'gpt-5.6-terra', 'high', 'standard', 'queued', 3)",
        "a".repeat(40),
        "b".repeat(40),
      );
    },
    evaluationId: "evaluation-1",
  },
  {
    code: "capacity_unavailable",
    name: "shared queue capacity",
    prepare(core) {
      core.run(
        "INSERT INTO codex_execution_queue (work_id, work_kind, ready_at, accepted_at) VALUES ('run-1', 'review_run', 1, 1)",
      );
      for (let index = 2; index <= 25; index += 1) {
        core.transaction((/** @type {any} */ transaction) => {
          transaction.run(
            "INSERT INTO reviews (id, name, description, active_version_id, created_at) VALUES (?, ?, 'Capacity Review', ?, ?)",
            `capacity-review-${index}`,
            `Capacity Review ${index}`,
            `capacity-version-${index}`,
            index,
          );
          transaction.run(
            "INSERT INTO review_versions (id, review_id, number, model, reasoning_effort, service_tier, created_at, sealed_at) VALUES (?, ?, 1, 'gpt-5.6-terra', 'high', 'standard', ?, ?)",
            `capacity-version-${index}`,
            `capacity-review-${index}`,
            index,
            index,
          );
          transaction.run(
            "INSERT INTO review_runs (id, evaluation_id, review_id, review_version_id, execution_status, created_at) VALUES (?, 'evaluation-1', ?, ?, 'queued', ?)",
            `capacity-run-${index}`,
            `capacity-review-${index}`,
            `capacity-version-${index}`,
            index,
          );
        });
        core.run(
          "INSERT INTO codex_execution_queue (work_id, work_kind, ready_at, accepted_at) VALUES (?, 'review_run', ?, ?)",
          `capacity-run-${index}`,
          index,
          index,
        );
      }
    },
    evaluationId: "evaluation-1",
  },
];
for (const scenario of rejectionScenarios) {
  test(`${scenario.name} rejection creates no partial batch or idempotency key`, () => {
    const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-reject-"));
    const core = openDurableCore(join(directory, "quality-bar.sqlite"));
    try {
      seedCompletedEvaluation(core);
      scenario.prepare(core);
      const beforeRequests = core.get(
        "SELECT count(*) AS count FROM waiver_requests",
      )?.count;
      const beforeAdjudications = core.get(
        "SELECT count(*) AS count FROM waiver_adjudications",
      )?.count;
      const beforeIdempotency = core.get(
        "SELECT count(*) AS count FROM waiver_batch_idempotency",
      )?.count;
      const service = createWaiverBatchService(core, {
        createAdjudicationId: () => "rejected-adjudication",
        createRequestId: () => "rejected-request",
        now: () => 1_753_800_000_000,
        readCodexCapabilityFailure: () => null,
        storageReserve: { assertWorkAdmissionAvailable() {} },
      });
      assert.throws(
        () =>
          service.submit({
            channel: "implementer_token",
            evaluationId: scenario.evaluationId,
            idempotencyKey: "rejected-key",
            request: {
              requests: [
                {
                  finding_id: "finding-1",
                  rationale: "Scenario-specific reason",
                },
              ],
            },
          }),
        (error) =>
          error instanceof Error &&
          "code" in error &&
          error.code === scenario.code,
      );
      assert.equal(
        core.get("SELECT count(*) AS count FROM waiver_requests")?.count,
        beforeRequests,
      );
      assert.equal(
        core.get("SELECT count(*) AS count FROM waiver_adjudications")?.count,
        beforeAdjudications,
      );
      assert.equal(
        core.get("SELECT count(*) AS count FROM waiver_batch_idempotency")
          ?.count,
        beforeIdempotency,
      );
    } finally {
      core.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
}
