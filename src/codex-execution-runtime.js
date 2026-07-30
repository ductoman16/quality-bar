import { randomUUID } from "node:crypto";

import { createCodexExecutionClaimService } from "./codex-execution-claim.js";
import { executeClaimWithOwningAdapter } from "./codex-execution-dispatch.js";
import { createCodexExecutionWorker } from "./codex-execution-worker.js";
import { executeReviewRun } from "./review-run-execution.js";
import { createReviewRunResultService } from "./review-run-result.js";
import { executeWaiverAdjudication } from "./waiver-adjudication-execution.js";
import { createWaiverAdjudicationResultService } from "./waiver-adjudication-result-service.js";

/** @param {any} durableCore @param {import("./codex-execution-claim.js").CodexExecutionClaim} claim */
function readRepositoryId(durableCore, claim) {
  const row =
    claim.workKind === "review_run"
      ? durableCore.get(
          `SELECT evaluations.repository_id
           FROM review_runs
           JOIN evaluations ON evaluations.id = review_runs.evaluation_id
           WHERE review_runs.id = ?`,
          claim.workId,
        )
      : durableCore.get(
          `SELECT evaluations.repository_id
           FROM waiver_adjudications
           JOIN evaluations
             ON evaluations.id = waiver_adjudications.evaluation_id
           WHERE waiver_adjudications.id = ?`,
          claim.workId,
        );
  if (typeof row?.repository_id !== "string") {
    throw new TypeError("Codex execution Repository is unavailable");
  }
  return row.repository_id;
}

/** @param {any} claimService @param {any} storageReserve */
export function createStorageGuardedClaimService(claimService, storageReserve) {
  if (
    typeof claimService?.start !== "function" ||
    typeof storageReserve?.assertCodexStartAvailable !== "function"
  ) {
    throw new TypeError("Codex start gate dependencies are invalid");
  }
  return {
    ...claimService,
    /** @param {any} claim @param {string} codexCliVersion */
    start(claim, codexCliVersion) {
      storageReserve.assertCodexStartAvailable();
      return claimService.start(claim, codexCliVersion);
    },
  };
}

/**
 * @param {any} durableCore
 * @param {{
 *   ioPool: any,
 *   now?: () => number,
 *   repositories: {acquireGitCredential: (repositoryId: string) => Promise<any>},
 *   reportFailure: (error: unknown, claim?: import("./codex-execution-claim.js").CodexExecutionClaim) => unknown,
 *   spawnProcess: (...parameters: any[]) => import("node:child_process").ChildProcess,
 *   storageReserve: {assertCodexStartAvailable: () => unknown}
 * }} dependencies
 */
export function createCodexExecutionRuntime(
  durableCore,
  {
    ioPool,
    now = () => Date.now(),
    repositories,
    reportFailure,
    spawnProcess,
    storageReserve,
  },
) {
  if (
    typeof durableCore?.get !== "function" ||
    typeof repositories?.acquireGitCredential !== "function" ||
    typeof ioPool?.run !== "function" ||
    typeof now !== "function" ||
    typeof reportFailure !== "function" ||
    typeof spawnProcess !== "function" ||
    typeof storageReserve?.assertCodexStartAvailable !== "function"
  ) {
    throw new TypeError("Codex execution runtime dependencies are invalid");
  }
  const claimService = createCodexExecutionClaimService(durableCore, {
    createWorkerId: randomUUID,
    now,
  });
  const guardedClaimService = createStorageGuardedClaimService(
    claimService,
    storageReserve,
  );
  const reviewResults = createReviewRunResultService(durableCore, { now });
  const waiverResults = createWaiverAdjudicationResultService(durableCore, {
    now,
  });

  /** @param {import("./codex-execution-claim.js").CodexExecutionClaim} claim */
  async function credential(claim) {
    return repositories.acquireGitCredential(
      readRepositoryId(durableCore, claim),
    );
  }

  return createCodexExecutionWorker({
    claimService,
    reportFailure,
    executeClaim: (claim) =>
      executeClaimWithOwningAdapter(claim, {
        async executeReviewRun(reviewClaim) {
          return executeReviewRun(durableCore, reviewClaim, {
            acquireCheckoutCredential: () => credential(reviewClaim),
            claimService: guardedClaimService,
            ioPool,
            resultService: reviewResults,
            spawnProcess,
          });
        },
        async executeWaiverAdjudication(adjudicationClaim) {
          return executeWaiverAdjudication(durableCore, adjudicationClaim, {
            acquireCheckoutCredential: () => credential(adjudicationClaim),
            claimService: guardedClaimService,
            ioPool,
            resultService: waiverResults,
            spawnProcess,
          });
        },
      }),
  });
}
