/** @param {unknown} value */
export function requireAutomaticEvaluationAdmission(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof Reflect.get(value, "afterCommit") !== "function" ||
    !Reflect.get(value, "resource")
  ) {
    throw new TypeError("Automatic Evaluation admission result is invalid");
  }
  return /** @type {{afterCommit: () => void, resource: any}} */ (value);
}

/** @param {{afterCommit: () => void}[]} admissions */
export function completeAutomaticEvaluationAdmissions(admissions) {
  for (const admission of admissions) {
    admission.afterCommit();
  }
}

/**
 * @param {any} transaction
 * @param {any[]} inputs
 * @param {(transaction: any, input: any) => unknown} admit
 */
export function admitAutomaticEvaluations(transaction, inputs, admit) {
  return inputs.map((input) =>
    requireAutomaticEvaluationAdmission(admit(transaction, input)),
  );
}

/** @param {{changeset: any}[]} inputs @param {Set<any>} releaseAttempted */
export function releaseAutomaticEvaluationChangesets(inputs, releaseAttempted) {
  for (const { changeset } of inputs) {
    releaseAttempted.add(changeset);
    changeset.release?.();
  }
}

/**
 * @param {unknown} previous
 * @param {unknown} current
 * @param {string} repositoryId
 * @param {(input: {pullRequest: any, repositoryId: string}) => Promise<any>} acquire
 */
export async function acquireAutomaticEvaluations(
  previous,
  current,
  repositoryId,
  acquire,
) {
  const evaluations = [];
  for (const pullRequest of newlyEligibleGitHubPullRequests(
    previous,
    current,
  )) {
    evaluations.push({
      changeset: await acquire({ pullRequest, repositoryId }),
      pullRequestNumber: pullRequest.number,
      repositoryId,
    });
  }
  return evaluations;
}
import { newlyEligibleGitHubPullRequests } from "./github-automatic-evaluation.js";
