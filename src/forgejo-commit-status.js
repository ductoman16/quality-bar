import { githubCommitStatusForEvaluation } from "./github-commit-status.js";

export const FORGEJO_COMMIT_STATUS_CONTEXT = "Quality Bar";

/** @param {unknown} outcome */
export function forgejoCommitStatusForEvaluation(outcome) {
  return githubCommitStatusForEvaluation(outcome);
}
