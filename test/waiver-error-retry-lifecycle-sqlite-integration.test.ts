import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createWaiverAdjudicationResultService } from "../src/waiver/waiver-adjudication-result-service.ts";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.ts";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.ts";

function startAdjudication(
  core: any,
  adjudicationId: string,
  workerId: string,
) {
  core.run(
    `UPDATE codex_execution_queue
     SET worker_id = ?, fencing_token = 1,
         lease_expires_at = 100, started_at = 11
     WHERE work_id = ?`,
    workerId,
    adjudicationId,
  );
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = 11,
         codex_cli_version = '0.145.0'
     WHERE id = ?`,
    adjudicationId,
  );
}

test("error retry does not recover a newer failed Adjudication", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-waiver-failed-retry-"),
  );
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core);
    const service = createWaiverBatchService(core, {
      createAdjudicationId: (() => {
        const ids = [
          "adjudication-error",
          "adjudication-retry",
          "adjudication-unused",
        ];
        return () => ids.shift() as string;
      })(),
      createRequestId: () => "request-error",
      now: () => 10,
      readCodexCapabilityFailure: () => null,
      storageReserve: { assertWorkAdmissionAvailable() {} },
    });
    service.submit({
      channel: "browser_session",
      evaluationId: "evaluation-1",
      idempotencyKey: "initial-error",
      request: {
        requests: [
          {
            finding_id: "finding-1",
            rationale: "Required evidence is temporarily unavailable.",
          },
        ],
      },
    });
    startAdjudication(core, "adjudication-error", "error-worker");
    createWaiverAdjudicationResultService(core, {
      createDecisionId: () => "decision-error",
      now: () => 12,
    }).prepare(
      {
        fencingToken: 1,
        workerId: "error-worker",
        workId: "adjudication-error",
      },
      {
        decisions: [
          {
            error: {
              code: "required_evidence_unavailable",
              detail: "Required evidence cannot be inspected.",
            },
            outcome: "error",
            request_id: "request-error",
          },
        ],
      },
    );
    service.retryErrors({
      channel: "browser_session",
      evaluationId: "evaluation-1",
      idempotencyKey: "retry-error",
      request: { request_ids: ["request-error"] },
    });
    startAdjudication(core, "adjudication-retry", "retry-worker");
    createWaiverAdjudicationResultService(core, {
      createDecisionId: () => assert.fail("failure created a Decision"),
      now: () => 13,
    }).fail(
      {
        fencingToken: 1,
        workerId: "retry-worker",
        workId: "adjudication-retry",
      },
      Object.assign(new Error("Codex process failed"), {
        code: "codex_process_failed",
      }),
    );

    assert.throws(
      () =>
        service.retryErrors({
          channel: "browser_session",
          evaluationId: "evaluation-1",
          idempotencyKey: "retry-failed-adjudication",
          request: { request_ids: ["request-error"] },
        }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "waiver_error_retry_ineligible",
    );
    assert.equal(
      core.get("SELECT count(*) AS count FROM waiver_requests")?.count,
      1,
    );
    assert.equal(
      core.get("SELECT count(*) AS count FROM waiver_adjudications")?.count,
      2,
    );
    assert.equal(
      core.get(
        `SELECT count(*) AS count FROM waiver_batch_idempotency
         WHERE idempotency_key = 'retry-failed-adjudication'`,
      )?.count,
      0,
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
