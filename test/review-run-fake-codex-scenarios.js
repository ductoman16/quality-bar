/** @type {Readonly<Record<string, {arguments: string[], criterionErrorCode?: string | null, criterionErrorDetail?: string | null, evaluationOutcome?: string, evidenceFailure?: boolean, executionErrorCode?: string, finding?: boolean, specialResult?: string}>>} */
export const fakeCodexScenarios = Object.freeze({
  clear: {
    arguments: ["--fake-correction"],
    criterionErrorCode: null,
    criterionErrorDetail: null,
    evaluationOutcome: "clear",
  },
  deadline: {
    arguments: ["--fake-deadline"],
    executionErrorCode: "deadline_exceeded",
    specialResult: "deadline",
  },
  error: {
    arguments: ["--fake-error"],
    criterionErrorCode: "required_evidence_unavailable",
    criterionErrorDetail:
      "The required generated file is absent from the head.",
    evaluationOutcome: "error",
  },
  evidence_failure: {
    arguments: ["--fake-correction"],
    evidenceFailure: true,
    executionErrorCode: "storage_unavailable",
    specialResult: "evidence_failure",
  },
  not_applicable: {
    arguments: ["--fake-not-applicable"],
    criterionErrorCode: null,
    criterionErrorDetail: null,
    evaluationOutcome: "clear",
  },
  process_failure: {
    arguments: ["--fake-process-failure"],
    executionErrorCode: "codex_process_failed",
    specialResult: "process_failure",
  },
  triggered: {
    arguments: ["--fake-triggered"],
    criterionErrorCode: null,
    criterionErrorDetail: null,
    evaluationOutcome: "blocking",
    finding: true,
  },
});
