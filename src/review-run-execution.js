import { runReviewRunCodex } from "./review-run-codex-adapter.js";
import { prepareReviewRunCheckout } from "./review-run-checkout.js";
import { ReviewRunExecutionError } from "./review-run-result.js";

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {never}
 */
function fail(code, message, cause) {
  throw new ReviewRunExecutionError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined
 * }} durableCore
 * @param {string} workId
 */
function readRun(durableCore, workId) {
  const run = durableCore.get(
    `SELECT review_runs.id, review_runs.execution_status,
            evaluations.base_commit, evaluations.head_commit,
            repositories.normalized_url,
            reviews.name,
            review_versions.model, review_versions.reasoning_effort,
            review_versions.service_tier, review_versions.applicability_rule
     FROM review_runs
     JOIN evaluations ON evaluations.id = review_runs.evaluation_id
     JOIN repositories ON repositories.id = evaluations.repository_id
     JOIN reviews ON reviews.id = review_runs.review_id
     JOIN review_versions ON review_versions.id = review_runs.review_version_id
     WHERE review_runs.id = ?`,
    workId,
  );
  if (!run || run.execution_status !== "queued") {
    fail("review_run_state_invalid", "Review Run is not queued for execution");
  }
  if (run.applicability_rule !== null) {
    fail(
      "review_run_applicability_unsupported",
      "Only unconditional Reviews are supported by this Review Run",
    );
  }
  const criteria = durableCore
    .all(
      `SELECT criterion_id, impact, instruction
       FROM review_version_criteria
       JOIN review_runs
         ON review_runs.review_version_id =
            review_version_criteria.review_version_id
       WHERE review_runs.id = ?
       ORDER BY position`,
      workId,
    )
    .map((criterion) => {
      if (
        typeof criterion?.criterion_id !== "string" ||
        typeof criterion.impact !== "string" ||
        typeof criterion.instruction !== "string"
      ) {
        throw new TypeError("Frozen Review Criterion is invalid");
      }
      return {
        criterionId: criterion.criterion_id,
        impact: criterion.impact,
        instruction: criterion.instruction,
      };
    });
  if (
    typeof run.base_commit !== "string" ||
    typeof run.head_commit !== "string" ||
    typeof run.normalized_url !== "string" ||
    typeof run.name !== "string" ||
    criteria.length === 0
  ) {
    throw new TypeError("Frozen Review Run is invalid");
  }
  const prompt = [
    "Run this Quality Bar Review against only the frozen Changeset.",
    `base_commit: ${run.base_commit}`,
    `head_commit: ${run.head_commit}`,
    `review: ${run.name}`,
    ...criteria.flatMap((criterion) => [
      `criterion_id: ${criterion.criterionId}`,
      `impact: ${criterion.impact}`,
      `instruction: ${criterion.instruction}`,
    ]),
    `Submit one complete result with: quality-bar-submit`,
  ].join("\n");
  return {
    baseCommit: run.base_commit,
    configuration: {
      model: run.model,
      reasoning_effort: run.reasoning_effort,
      service_tier: run.service_tier,
    },
    criteria,
    headCommit: run.head_commit,
    prompt,
    repositoryUrl: run.normalized_url,
  };
}

/**
 * @param {any} durableCore
 * @param {{fencingToken: number, workerId: string, workId: string}} claim
 * @param {{
 *   checkoutRoot?: string,
 *   claimService: {
 *     start(claim: any): unknown,
 *     startRenewal(claim: any, onClaimLost: (error: unknown) => void): () => void
 *   },
 *   codexCommand?: string,
 *   codexPrefixArguments?: string[],
 *   prepareCheckout?: typeof prepareReviewRunCheckout,
 *   resultService: {submit(claim: any, candidate: unknown): unknown},
 *   runCodex?: typeof runReviewRunCodex,
 *   spawnProcess?: (
 *     command: string,
 *     arguments_: string[],
 *     options: import("node:child_process").SpawnOptions
 *   ) => import("node:child_process").ChildProcess
 * }} options
 */
export async function executeReviewRun(
  durableCore,
  claim,
  {
    checkoutRoot = "/var/cache/quality-bar/checkouts",
    claimService,
    prepareCheckout = prepareReviewRunCheckout,
    resultService,
    runCodex = runReviewRunCodex,
    ...codexOptions
  },
) {
  const run = readRun(durableCore, claim.workId);
  /** @type {Error | null} */
  let claimFailure = null;
  const stopRenewal = claimService.startRenewal(claim, (error) => {
    claimFailure =
      error instanceof Error
        ? error
        : new TypeError("Review Run claim renewal failed");
  });
  try {
    const checkout = await prepareCheckout({
      baseCommit: run.baseCommit,
      checkoutRoot,
      fencingToken: claim.fencingToken,
      headCommit: run.headCommit,
      repositoryUrl: run.repositoryUrl,
      workId: claim.workId,
    });
    try {
      if (claimFailure) {
        throw claimFailure;
      }
      claimService.start(claim);
      await runCodex({
        checkoutPath: checkout.path,
        claim,
        resultService,
        run,
        ...codexOptions,
      });
    } finally {
      checkout.remove();
    }
  } finally {
    stopRenewal();
  }
}
