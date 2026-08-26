import assert from "node:assert/strict";

const successfulExecution = (execution: () => Promise<unknown>) => execution();
const failedExecution =
  (code: string) => async (execution: () => Promise<unknown>) => {
    await assert.rejects(
      execution,
      (error: any) =>
        error instanceof Error && "code" in error && error.code === code,
    );
  };
const durableEvidence = ({ durableEvidence: service }: any) => service;
const noTimers = () => ({});

function deadlineEvidence({ deadlineEvidence: service }: any) {
  return service;
}

function cancellationEvidence({ cancellationEvidence: service }: any) {
  return service;
}

function deadlineTimers({ setForceKill, setSignalDeadline }: any) {
  return {
    clearDeadlineTimer() {},
    clearTerminationTimer() {},
    setDeadlineTimer(callback: () => void, milliseconds: number) {
      assert.equal(milliseconds, 15 * 60 * 1_000);
      setSignalDeadline(callback);
      return {};
    },
    setTerminationTimer(callback: () => void, milliseconds: number) {
      assert.equal(milliseconds, 5_000);
      setForceKill(callback);
      return {};
    },
  };
}

function cancellationTimers({ setForceKill }: any) {
  return {
    clearTerminationTimer() {},
    setTerminationTimer(callback: () => void, milliseconds: number) {
      assert.equal(milliseconds, 5_000);
      setForceKill(callback);
      return {};
    },
  };
}

function failingEvidence({ durableEvidence: service, evidenceFailure }: any) {
  return {
    appendTranscriptChunk: service.appendTranscriptChunk.bind(service),
    complete() {
      throw evidenceFailure;
    },
  };
}

function verifyDeadline({ core, claim, deadlineSubmissionOutcome }: any) {
  assert.deepEqual(
    core.get(
      `SELECT execution_status, error_code, error_detail,
              process_exit_code, process_signal,
              execution_evidence_recorded
       FROM review_runs WHERE id = ?`,
      claim.workId,
    ),
    {
      error_code: "deadline_exceeded",
      error_detail: "Codex Review Run exceeded its 15-minute deadline",
      execution_evidence_recorded: 1,
      execution_status: "failed",
      process_exit_code: null,
      process_signal: "SIGKILL",
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    0,
  );
  assert.equal(core.get("SELECT count(*) AS count FROM findings")?.count, 0);
  assert.equal(deadlineSubmissionOutcome, "rejected");
  const transcript = core
    .all(
      `SELECT content FROM review_run_transcript_chunks
       WHERE review_run_id = ? ORDER BY sequence`,
      claim.workId,
    )
    .map((chunk: any) => chunk?.content)
    .join("");
  assert.match(transcript, /"type":"fake\.deadline_submission_rejected"/);
  assert.doesNotMatch(transcript, /fake\.deadline_submission_accepted/);
}

function verifyCancellation({
  core,
  claim,
  cancellationSubmissionOutcome,
}: any) {
  assert.deepEqual(
    core.get(
      `SELECT evaluations.execution_status,
              evaluations.cancellation_requested_at,
              evaluation_results.outcome,
              review_runs.execution_status AS review_run_status,
              review_runs.process_signal,
              review_runs.execution_evidence_recorded
       FROM evaluations
       JOIN evaluation_results
         ON evaluation_results.evaluation_id = evaluations.id
       JOIN review_runs
         ON review_runs.evaluation_id = evaluations.id
       WHERE review_runs.id = ?`,
      claim.workId,
    ),
    {
      cancellation_requested_at: 25,
      execution_evidence_recorded: 1,
      execution_status: "cancelled",
      outcome: "error",
      process_signal: "SIGKILL",
      review_run_status: "cancelled",
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    0,
  );
  assert.equal(core.get("SELECT count(*) AS count FROM findings")?.count, 0);
  assert.equal(cancellationSubmissionOutcome, "rejected");
}

function verifyProcessFailure({ core, claim }: any) {
  assert.deepEqual(
    core.get(
      `SELECT execution_status, process_exit_code, process_signal,
              execution_evidence_recorded
       FROM review_runs WHERE id = ?`,
      claim.workId,
    ),
    {
      execution_evidence_recorded: 1,
      execution_status: "failed",
      process_exit_code: 1,
      process_signal: null,
    },
  );
  assert.ok(
    Number(
      core.get(
        `SELECT count(*) AS count
         FROM review_run_transcript_chunks
         WHERE review_run_id = ?`,
        claim.workId,
      )?.count,
    ) >= 2,
  );
}

function verifyNoSubmission({ core, claim }: any) {
  assert.deepEqual(
    core.get(
      `SELECT execution_status, error_code, error_detail,
              process_exit_code, process_signal,
              execution_evidence_recorded
       FROM review_runs WHERE id = ?`,
      claim.workId,
    ),
    {
      error_code: "result_not_submitted",
      error_detail: "Codex Review Run exited without an accepted Result",
      execution_evidence_recorded: 1,
      execution_status: "failed",
      process_exit_code: 0,
      process_signal: null,
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    0,
  );
  assert.equal(core.get("SELECT count(*) AS count FROM findings")?.count, 0);
  const transcript = core
    .all(
      `SELECT content FROM review_run_transcript_chunks
       WHERE review_run_id = ? ORDER BY sequence`,
      claim.workId,
    )
    .map((chunk: any) => chunk?.content)
    .join("");
  assert.match(transcript, /Review complete in prose only/);
  assert.match(transcript, /turn\.completed/);
}

function verifyAuthenticationFailure({ core, claim }: any) {
  assert.deepEqual(
    core.get(
      `SELECT execution_status, error_code, error_detail,
              process_exit_code, process_signal,
              execution_evidence_recorded
       FROM review_runs WHERE id = ?`,
      claim.workId,
    ),
    {
      error_code: "authentication_failed",
      error_detail: "You must be logged in to use Codex. Run codex login.",
      execution_evidence_recorded: 1,
      execution_status: "failed",
      process_exit_code: 1,
      process_signal: null,
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    0,
  );
  assert.equal(core.get("SELECT count(*) AS count FROM findings")?.count, 0);
  const transcript = core.all(
    `SELECT stream, content
     FROM review_run_transcript_chunks
     WHERE review_run_id = ?
     ORDER BY sequence`,
    claim.workId,
  );
  const stdout = transcript
    .filter((chunk: any) => chunk.stream === "stdout")
    .map((chunk: any) => chunk.content)
    .join("");
  const stderr = transcript
    .filter((chunk: any) => chunk.stream === "stderr")
    .map((chunk: any) => chunk.content)
    .join("");
  assert.equal(
    stdout,
    '{"error":{"message":"You must be logged in to use Codex. Run codex login."},"type":"turn.failed"}\n',
  );
  assert.equal(
    stderr.slice(0, "fake Codex authentication diagnostic\n".length),
    "fake Codex authentication diagnostic\n",
  );
  assert.deepEqual(
    core.get(
      `SELECT evaluations.execution_status, evaluation_results.outcome
       FROM evaluations
       JOIN evaluation_results
         ON evaluation_results.evaluation_id = evaluations.id
       WHERE evaluations.id = 'evaluation-1'`,
    ),
    { execution_status: "completed", outcome: "error" },
  );
}

function verifyEvidenceFailure({ core, claim }: any) {
  assert.deepEqual(
    core.get(
      `SELECT review_runs.execution_status,
              review_runs.execution_evidence_recorded,
              evaluations.execution_status,
              evaluation_results.outcome,
              criterion_results.outcome AS criterion_outcome
       FROM review_runs
       JOIN evaluations
         ON evaluations.id = review_runs.evaluation_id
       JOIN evaluation_results
         ON evaluation_results.evaluation_id = evaluations.id
       JOIN criterion_results
         ON criterion_results.review_run_id = review_runs.id
       WHERE review_runs.id = ?`,
      claim.workId,
    ),
    {
      criterion_outcome: "clear",
      execution_evidence_recorded: 0,
      execution_status: "completed",
      outcome: "clear",
    },
  );
}

const common = {
  criterionErrorCode: undefined,
  criterionErrorDetail: undefined,
  createEvidenceService: durableEvidence,
  createTimerOptions: noTimers,
  evaluationOutcome: undefined,
  execute: successfulExecution,
  finding: false,
  verifySpecialResult: undefined,
};

export const fakeCodexScenarios = Object.freeze({
  authentication_failure: {
    ...common,
    arguments: ["--fake-authentication-failure"],
    execute: failedExecution("authentication_failed"),
    verifySpecialResult: verifyAuthenticationFailure,
  },
  cancellation: {
    ...common,
    arguments: ["--fake-cancellation"],
    createEvidenceService: cancellationEvidence,
    createTimerOptions: cancellationTimers,
    verifySpecialResult: verifyCancellation,
  },
  clear: {
    ...common,
    arguments: ["--fake-correction"],
    criterionErrorCode: null,
    criterionErrorDetail: null,
    evaluationOutcome: "clear",
  },
  deadline: {
    ...common,
    arguments: ["--fake-deadline"],
    createEvidenceService: deadlineEvidence,
    createTimerOptions: deadlineTimers,
    execute: failedExecution("deadline_exceeded"),
    verifySpecialResult: verifyDeadline,
  },
  error: {
    ...common,
    arguments: ["--fake-error"],
    criterionErrorCode: "required_evidence_unavailable",
    criterionErrorDetail:
      "The required generated file is absent from the head.",
    evaluationOutcome: "error",
  },
  evidence_failure: {
    ...common,
    arguments: ["--fake-correction"],
    createEvidenceService: failingEvidence,
    execute: failedExecution("storage_unavailable"),
    verifySpecialResult: verifyEvidenceFailure,
  },
  inspect_on_demand: {
    ...common,
    arguments: ["--fake-inspect-on-demand"],
    criterionErrorCode: null,
    criterionErrorDetail: null,
    evaluationOutcome: "clear",
  },
  not_applicable: {
    ...common,
    arguments: ["--fake-not-applicable"],
    criterionErrorCode: null,
    criterionErrorDetail: null,
    evaluationOutcome: "clear",
  },
  no_submission: {
    ...common,
    arguments: ["--fake-no-submission"],
    execute: failedExecution("result_not_submitted"),
    verifySpecialResult: verifyNoSubmission,
  },
  process_failure: {
    ...common,
    arguments: ["--fake-process-failure"],
    execute: failedExecution("codex_process_failed"),
    verifySpecialResult: verifyProcessFailure,
  },
  triggered: {
    ...common,
    arguments: ["--fake-triggered"],
    criterionErrorCode: null,
    criterionErrorDetail: null,
    evaluationOutcome: "blocking",
    finding: true,
  },
});
