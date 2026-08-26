import assert from "node:assert/strict";

import { createIoExecutionPool } from "../../src/io-execution-pool.ts";
import { createWaiverAdjudicationClaimService } from "../../src/waiver/waiver-adjudication-claim.ts";
import { createWaiverAdjudicationEvidenceService } from "../../src/waiver/waiver-adjudication-evidence.ts";
import { executeWaiverAdjudication } from "../../src/waiver/waiver-adjudication-execution.ts";
import { createWaiverAdjudicationRecoveryService } from "../../src/waiver/waiver-adjudication-recovery.ts";
import { createWaiverAdjudicationResultService } from "../../src/waiver/waiver-adjudication-result-service.ts";

export async function recoverStartedAdjudicationWithFakeCodex({
  checkoutRoot,
  core,
  fakeCodex,
}: {
  checkoutRoot: string;
  core: any;
  fakeCodex: string;
}) {
  const recovered = createWaiverAdjudicationRecoveryService(core, {
    createAdjudicationId: () => "adjudication-recovered",
    now: () => 40,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).recover({
    adjudicationId: "adjudication-1",
    channel: "browser_session",
    idempotencyKey: "recover-started-process-failure",
  });
  assert.equal(recovered.status, 201);
  assert.equal(recovered.resource.adjudication.id, "adjudication-recovered");

  const claims = createWaiverAdjudicationClaimService(core, {
    createWorkerId: () => "recovery-worker",
    now: () => 41,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  assert.equal(claim.workId, "adjudication-recovered");
  const decisionIds = [
    "recovered-decision-1",
    "recovered-decision-2",
    "recovered-decision-3",
  ];
  const ioPool = createIoExecutionPool({
    reportBackgroundFailure() {
      assert.fail("Unexpected background I/O failure");
    },
  });
  try {
    await executeWaiverAdjudication(core, claim, {
      checkoutRoot,
      claimService: claims,
      codexCommand: process.execPath,
      codexPrefixArguments: [fakeCodex],
      evidenceService: createWaiverAdjudicationEvidenceService(core),
      ioPool,
      processEnvironment: {
        CODEX_HOME: "/var/lib/quality-bar/codex",
        HOME: "/var/lib/quality-bar",
        LANG: "C.UTF-8",
        PATH: "/usr/local/bin:/usr/bin",
      },
      resultService: createWaiverAdjudicationResultService(core, {
        createDecisionId: () =>
          decisionIds.shift() ?? assert.fail("missing Decision identity"),
        now: () => 42,
      }),
    });
  } finally {
    await ioPool.close();
  }
  assert.deepEqual(
    core.all(
      `SELECT id, execution_status, error_code
       FROM waiver_adjudications ORDER BY rowid`,
    ),
    [
      {
        error_code: "result_not_submitted",
        execution_status: "failed",
        id: "adjudication-1",
      },
      {
        error_code: null,
        execution_status: "completed",
        id: "adjudication-recovered",
      },
    ],
  );
  assert.equal(
    core.get(
      `SELECT count(*) AS count FROM waiver_decisions
       WHERE waiver_adjudication_id = 'adjudication-recovered'`,
    )?.count,
    3,
  );
}
