import { randomUUID } from "node:crypto";

import { createCodexExecutionClaimService } from "./codex-execution-claim.ts";
import { executeClaimWithOwningAdapter } from "./codex-execution-dispatch.ts";
import { createCodexExecutionWorker } from "./codex-execution-worker.ts";
import { prepareReviewRunCheckout } from "../review/review-run-checkout.ts";
import { executeReviewRun } from "../review/review-run-execution.ts";
import { createReviewRunResultService } from "../review/review-run-result.ts";
import { executeWaiverAdjudication } from "../waiver/waiver-adjudication-execution.ts";
import { createWaiverAdjudicationResultService } from "../waiver/waiver-adjudication-result-service.ts";

function readRepositoryId(
  durableCore: any,
  claim: import("./codex-execution-claim.ts").CodexExecutionClaim,
) {
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

export function createStorageGuardedClaimService(
  claimService: any,
  storageReserve: any,
) {
  if (
    typeof claimService?.start !== "function" ||
    typeof claimService?.startTracked !== "function" ||
    typeof storageReserve?.assertCodexStartAvailable !== "function"
  ) {
    throw new TypeError("Codex start gate dependencies are invalid");
  }
  return {
    ...claimService,
    start(claim: any, codexCliVersion: string) {
      storageReserve.assertCodexStartAvailable();
      return claimService.start(claim, codexCliVersion);
    },
    startTracked(claim: any, codexCliVersion: string, processGroupId: number) {
      storageReserve.assertCodexStartAvailable();
      return claimService.startTracked(claim, codexCliVersion, processGroupId);
    },
  };
}

export function createCodexExecutionRuntime(
  durableCore: any,
  {
    certificateAuthorityPath,
    ioPool,
    now = () => Date.now(),
    repositories,
    reportFailure,
    spawnProcess,
    storageReserve,
  }: {
    certificateAuthorityPath?: string;
    ioPool: any;
    now?: () => number;
    repositories: {
      acquireGitCredential: (repositoryId: string) => Promise<any>;
    };
    reportFailure: (
      error: unknown,
      claim?: import("./codex-execution-claim.ts").CodexExecutionClaim,
    ) => unknown;
    spawnProcess: (
      ...parameters: any[]
    ) => import("node:child_process").ChildProcess;
    storageReserve: { assertCodexStartAvailable: () => unknown };
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

  async function credential(
    claim: import("./codex-execution-claim.ts").CodexExecutionClaim,
  ) {
    return repositories.acquireGitCredential(
      readRepositoryId(durableCore, claim),
    );
  }

  function prepareCheckout(
    input: Parameters<typeof prepareReviewRunCheckout>[0],
  ) {
    return prepareReviewRunCheckout({ ...input, certificateAuthorityPath });
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
            prepareCheckout,
            resultService: reviewResults,
            spawnProcess,
          });
        },
        async executeWaiverAdjudication(adjudicationClaim) {
          return executeWaiverAdjudication(durableCore, adjudicationClaim, {
            acquireCheckoutCredential: () => credential(adjudicationClaim),
            claimService: guardedClaimService,
            ioPool,
            prepareCheckout,
            resultService: waiverResults,
            spawnProcess,
          });
        },
      }),
  });
}
