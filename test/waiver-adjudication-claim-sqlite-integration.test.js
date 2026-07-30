import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createWaiverAdjudicationClaimService } from "../src/waiver-adjudication-claim.js";
import { createWaiverBatchService } from "../src/waiver-batch.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

test("the focused worker claims and starts only Waiver Adjudications", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-claim-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core);
    createWaiverBatchService(core, {
      createAdjudicationId: () => "adjudication-1",
      createRequestId: () => "request-1",
      now: () => 10,
      readCodexCapabilityFailure: () => null,
      storageReserve: { assertWorkAdmissionAvailable() {} },
    }).submit({
      channel: "browser_session",
      evaluationId: "evaluation-1",
      idempotencyKey: "waiver-key",
      request: {
        requests: [{ finding_id: "finding-1", rationale: "Exact exception." }],
      },
    });
    const service = createWaiverAdjudicationClaimService(core, {
      createWorkerId: () => "waiver-worker",
      now: () => 11,
    });
    const claim = service.claimNext();
    assert.deepEqual(claim, {
      fencingToken: 1,
      leaseExpiresAt: 120_011,
      workerId: "waiver-worker",
      workId: "adjudication-1",
    });
    service.start(claim, "0.114.0");
    assert.deepEqual(
      core.get(
        `SELECT execution_status, started_at, codex_cli_version
         FROM waiver_adjudications WHERE id = 'adjudication-1'`,
      ),
      {
        codex_cli_version: "0.114.0",
        execution_status: "running",
        started_at: 11,
      },
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
