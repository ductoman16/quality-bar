export const GITHUB_COMMIT_STATUS_CONTEXT = "Quality Bar";

const STATUS_BY_OUTCOME = Object.freeze({
  advisory: Object.freeze({
    description: "Quality Bar Evaluation is advisory",
    state: "failure",
  }),
  blocking: Object.freeze({
    description: "Quality Bar Evaluation is blocking",
    state: "failure",
  }),
  clear: Object.freeze({
    description: "Quality Bar Evaluation is clear",
    state: "success",
  }),
  error: Object.freeze({
    description: "Quality Bar Evaluation has an error",
    state: "error",
  }),
  pending: Object.freeze({
    description: "Quality Bar Evaluation is active",
    state: "pending",
  }),
});

/** @param {unknown} outcome */
export function githubCommitStatusForEvaluation(outcome) {
  if (typeof outcome !== "string" || !(outcome in STATUS_BY_OUTCOME)) {
    throw new TypeError("Evaluation outcome is invalid");
  }
  return STATUS_BY_OUTCOME[
    /** @type {keyof typeof STATUS_BY_OUTCOME} */ (outcome)
  ];
}
