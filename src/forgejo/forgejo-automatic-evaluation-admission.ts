import { newlyEligibleForgejoPullRequests } from "./forgejo-automatic-evaluation.ts";
import { requireCodedError } from "../coded-error.ts";
import { StorageReserveError } from "../storage-reserve.ts";

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

function enrichForgejoAcquisitionFailure(error: unknown, pullRequest: any) {
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

function releaseAcquisitionsBeforeFailure(
  evaluations: { changeset: any }[],
  failure: Error,
) {
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

function isInterruptingAcquisitionFailure(failure: Error & { code?: string }) {
  return (
    failure instanceof StorageReserveError ||
    failure.code === "application_shutting_down"
  );
}

export async function acquireForgejoAutomaticEvaluations(
  previous: unknown,
  current: unknown,
  repositoryId: string,
  acquire: (input: { pullRequest: any; repositoryId: string }) => Promise<any>,
) {
  const evaluations: {
    changeset: any;
    provider: "forgejo";
    pullRequestNumber: number;
    repositoryId: string;
  }[] = [];
  const failures: unknown[] = [];
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
