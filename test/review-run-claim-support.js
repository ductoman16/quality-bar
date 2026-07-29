import { createEvaluationService } from "../src/evaluation.js";
import { createReviewService } from "../src/review.js";

/**
 * @param {ReturnType<typeof import("../src/durable-core.js").openDurableCore>} core
 */
export async function createQueuedReviewRun(core) {
  const evaluationId = "evaluation-1";
  const reviewRunId = "review-run-1";
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    `repository-${evaluationId}`,
    `https://example.invalid/${evaluationId}.git`,
    1,
    1,
  );
  let factId = 0;
  createReviewService(core, {
    createId: () => `${evaluationId}-review-fact-${++factId}`,
    now: () => 1,
  }).create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "blocking", instruction: "Prove the claim." }],
    description: "Review Run claim proof",
    name: `Claim proof ${evaluationId}`,
  });
  await createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    createId: () => evaluationId,
    createReviewRunId: () => reviewRunId,
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
