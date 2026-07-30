/**
 * @param {string} id
 * @param {number} createdAt
 * @param {string} outcome
 * @param {Record<string, unknown>} [overrides]
 */
export const evaluation = (id, createdAt, outcome, overrides = {}) => ({
  active_waiver_adjudication_count: 0,
  analytics_evaluation_id: id,
  automatic_pull_request_number: 42,
  base_commit: "a".repeat(40),
  blocking_finding_count: 0,
  created_at: createdAt,
  current_waiver_error_count: 0,
  execution_status: "completed",
  head_commit: String(id.at(-1)).repeat(40),
  repository_id: "repository-1",
  result_outcome: outcome,
  unwaived_advisory_finding_count: 0,
  ...overrides,
});

/**
 * @param {string} evaluationId
 * @param {number} createdAt
 * @param {string | null} outcome
 * @param {Record<string, unknown>} [overrides]
 */
export const progression = (
  evaluationId,
  createdAt,
  outcome,
  overrides = {},
) => ({
  criterion_id: "criterion-1",
  evaluation_created_at: createdAt,
  evaluation_id: evaluationId,
  model: "gpt-5.4",
  outcome,
  pull_request_number: 42,
  reasoning_effort: "high",
  repository_id: "repository-1",
  review_id: "review-1",
  review_version_id: "review-version-1",
  service_tier: "standard",
  ...overrides,
});
