import { createEvaluationService } from "../src/evaluation.js";
import { createReviewService } from "../src/review.js";

/**
 * @param {ReturnType<typeof import("../src/durable-core.js").openDurableCore>} core
 * @param {{
 *   applicabilityRule?: string | null,
 *   baseCommit?: string,
 *   fileChanges?: any[],
 *   headCommit?: string,
 *   matchesPath?: (pathspec: string, path: string) => boolean,
 *   readContent?: (fileChange: any, side: "before" | "after") => any,
 *   repositoryUrl?: string,
 *   reviewCount?: number
 * }} [options]
 */
export async function createQueuedReviewRun(
  core,
  {
    applicabilityRule = null,
    baseCommit = "1".repeat(40),
    fileChanges,
    headCommit = "2".repeat(40),
    matchesPath,
    readContent,
    repositoryUrl = "https://example.invalid/evaluation-1.git",
    reviewCount = 1,
  } = {},
) {
  const evaluationId = "evaluation-1";
  if (!Number.isSafeInteger(reviewCount) || reviewCount < 1) {
    throw new TypeError("Review Run proof count is invalid");
  }
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    `repository-${evaluationId}`,
    repositoryUrl,
    1,
    1,
  );
  let factId = 0;
  const reviews = createReviewService(core, {
    createId: () => `${evaluationId}-review-fact-${++factId}`,
    now: () => 1,
  });
  for (let index = 1; index <= reviewCount; index += 1) {
    const created = reviews.create({
      assignment: { scope: "installation_wide" },
      codex_configuration: {
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
      },
      criteria: [{ impact: "blocking", instruction: "Prove the claim." }],
      description: `Review Run claim proof ${index}`,
      name: `Claim proof ${evaluationId} ${index}`,
    });
    if (applicabilityRule !== null) {
      reviews.saveVersion(created.id, {
        applicability_rule: applicabilityRule,
        codex_configuration: created.active_version.codex_configuration,
        criteria: created.active_version.criteria.map((criterion) => ({
          id: criterion.id,
          impact: criterion.impact,
          instruction: criterion.instruction,
        })),
      });
    }
  }
  let reviewRun = 0;
  await createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: baseCommit,
      file_changes: fileChanges,
      head_commit: headCommit,
      matches_path: matchesPath,
      read_content: readContent,
    }),
    createId: () => evaluationId,
    createReviewRunId: () => `review-run-${++reviewRun}`,
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 10,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).createExplicit({
    channel: "browser_session",
    idempotencyKey: `claim-proof-${evaluationId}`,
    repositoryId: `repository-${evaluationId}`,
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "branch", value: "topic" },
    },
  });
}

/**
 * @param {ReturnType<typeof import("../src/durable-core.js").openDurableCore>} core
 */
export function createSiblingQueuedReviewRun(core) {
  const createdAt = 11;
  const evaluationId = "evaluation-2";
  const reviewRunId = "review-run-2";
  const sourceReviewRunId = "review-run-1";
  const frozenReview = core.get(
    "SELECT review_id, review_version_id FROM review_runs WHERE id = ?",
    sourceReviewRunId,
  );
  if (!frozenReview) {
    throw new Error("source Review Run is missing");
  }
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       base_commit, head_commit, execution_status, next_attempt_at, created_at
     )
     SELECT
       ?, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       ?, ?, 'queued', NULL, ?
     FROM evaluations WHERE id = (
       SELECT evaluation_id FROM review_runs WHERE id = ?
     )`,
    evaluationId,
    "3".repeat(40),
    "4".repeat(40),
    createdAt,
    sourceReviewRunId,
  );
  core.run(
    `INSERT INTO review_runs (
       id, evaluation_id, review_id, review_version_id,
       execution_status, created_at
     ) VALUES (?, ?, ?, ?, 'queued', ?)`,
    reviewRunId,
    evaluationId,
    frozenReview.review_id,
    frozenReview.review_version_id,
    createdAt,
  );
  core.run(
    `INSERT INTO codex_execution_queue (
       work_id, work_kind, ready_at, accepted_at, started_at
     ) VALUES (?, 'review_run', ?, ?, NULL)`,
    reviewRunId,
    createdAt,
    createdAt,
  );
}
