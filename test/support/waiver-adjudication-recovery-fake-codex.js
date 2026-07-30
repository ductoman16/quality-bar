import assert from "node:assert/strict";

import { createWaiverAdjudicationClaimService } from "../../src/waiver-adjudication-claim.js";
import { createWaiverAdjudicationEvidenceService } from "../../src/waiver-adjudication-evidence.js";
import { executeWaiverAdjudication } from "../../src/waiver-adjudication-execution.js";
import { createWaiverAdjudicationRecoveryService } from "../../src/waiver-adjudication-recovery.js";
import { createWaiverAdjudicationResultService } from "../../src/waiver-adjudication-result-service.js";

/** @param {{checkoutRoot: string, core: any, fakeCodex: string}} input */
export async function recoverStartedAdjudicationWithFakeCodex({
  checkoutRoot,
  core,
  fakeCodex,
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
  await executeWaiverAdjudication(core, claim, {
    checkoutRoot,
    claimService: claims,
    codexCommand: process.execPath,
    codexPrefixArguments: [fakeCodex],
    evidenceService: createWaiverAdjudicationEvidenceService(core),
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
