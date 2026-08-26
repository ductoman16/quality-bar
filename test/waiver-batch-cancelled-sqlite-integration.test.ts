import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.ts";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.ts";

test("a complete cancelled Result retains advisory Findings eligible for waiver", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-waiver-cancelled-"),
  );
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core);
    core.run(
      `UPDATE evaluations
       SET execution_status = 'cancelled',
           cancellation_requested_at = 3,
           cancellation_code = 'cancelled_by_operator',
           cancellation_detail = 'Evaluation was cancelled by the operator',
           completed_at = 3
       WHERE id = 'evaluation-1'`,
    );
    const accepted = createWaiverBatchService(core, {
      createAdjudicationId: () => "cancelled-result-adjudication",
      createRequestId: () => "cancelled-result-request",
      now: () => 1_753_800_000_000,
      readCodexCapabilityFailure: () => null,
      storageReserve: { assertWorkAdmissionAvailable() {} },
    }).submit({
      channel: "implementer_token",
      evaluationId: "evaluation-1",
      idempotencyKey: "cancelled-result-key",
      request: {
        requests: [
          {
            finding_id: "finding-1",
            rationale: "The completed sibling Finding remains applicable.",
          },
        ],
      },
    });
    assert.equal(accepted.status, 201);
    assert.deepEqual(
      core.get(
        "SELECT evaluation_id, execution_status FROM waiver_adjudications WHERE id = 'cancelled-result-adjudication'",
      ),
      { evaluation_id: "evaluation-1", execution_status: "queued" },
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
