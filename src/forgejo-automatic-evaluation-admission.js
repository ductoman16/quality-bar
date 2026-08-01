import { newlyEligibleForgejoPullRequests } from "./forgejo-automatic-evaluation.js";
import { requireCodedError } from "./coded-error.js";
import { StorageReserveError } from "./storage-reserve.js";

const LOCAL_ACQUISITION_FAILURES = new Set([
  "evaluation_git_acquisition_failed",
  "evaluation_git_acquisition_unavailable",
  "evaluation_selector_not_found",
  "forgejo_pull_request_head_inaccessible",
  "forgejo_pull_request_merge_base_inaccessible",
  "repository_authentication_failed",
  "repository_git_credentials_unavailable",
  "repository_git_read_failed",
  "repository_permission_denied",
]);

/** @param {unknown} error @param {any} pullRequest */
function enrichForgejoAcquisitionFailure(error, pullRequest) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    typeof error.code !== "string" ||
    !LOCAL_ACQUISITION_FAILURES.has(error.code)
  ) {
    return;
  }
  if (error.code === "forgejo_pull_request_head_inaccessible") {
    error.message = `Forgejo pull request #${pullRequest.number} head ${pullRequest.head.sha} is inaccessible`;
    return;
  }
  if (error.code === "forgejo_pull_request_merge_base_inaccessible") {
    error.message = `Forgejo pull request #${pullRequest.number} merge-base ${pullRequest.merge_base} is inaccessible`;
    return;
  }
  error.message = `Forgejo pull request #${pullRequest.number} at merge-base ${pullRequest.merge_base} and head ${pullRequest.head.sha}: ${error.message}`;
}

/** @param {{changeset: any}[]} evaluations @param {Error} failure */
function releaseAcquisitionsBeforeFailure(evaluations, failure) {
  const cleanupFailures = [];
  for (const { changeset } of evaluations) {
    try {
      changeset.release?.();
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (cleanupFailures.length > 0) {
    failure.cause = new AggregateError(
      [failure.cause, ...cleanupFailures].filter(Boolean),
      "Forgejo Changeset acquisition cleanup failed",
    );
  }
}

/** @param {Error & {code?: string}} failure */
function isInterruptingAcquisitionFailure(failure) {
  return (
    failure instanceof StorageReserveError ||
    failure.code === "application_shutting_down"
  );
}

/** @param {unknown} previous @param {unknown} current @param {string} repositoryId @param {(input: {pullRequest: any, repositoryId: string}) => Promise<any>} acquire */
export async function acquireForgejoAutomaticEvaluations(
  previous,
  current,
  repositoryId,
  acquire,
) {
  /** @type {{changeset: any, provider: "forgejo", pullRequestNumber: number, repositoryId: string}[]} */
  const evaluations = [];
  /** @type {unknown[]} */
  const failures = [];
  for (const pullRequest of newlyEligibleForgejoPullRequests(
    previous,
    current,
  )) {
    try {
      evaluations.push({
        changeset: await acquire({ pullRequest, repositoryId }),
        provider: "forgejo",
        pullRequestNumber: pullRequest.number,
        repositoryId,
      });
    } catch (error) {
      let failure;
      try {
        failure = requireCodedError(error);
      } catch (unexpectedFailure) {
        const unexpected =
          unexpectedFailure instanceof Error
            ? unexpectedFailure
            : new TypeError("Forgejo acquisition failure is invalid", {
                cause: unexpectedFailure,
              });
        releaseAcquisitionsBeforeFailure(evaluations, unexpected);
        throw unexpected;
      }
      if (isInterruptingAcquisitionFailure(failure)) {
        releaseAcquisitionsBeforeFailure(evaluations, failure);
        throw failure;
      }
      enrichForgejoAcquisitionFailure(failure, pullRequest);
      failures.push(failure);
    }
  }
  return { evaluations, failures };
}
