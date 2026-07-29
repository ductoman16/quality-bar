const timestamp = (/** @type {number} */ value) =>
  new Date(value).toISOString();

/** @param {Record<string, import("node:sqlite").SQLInputValue> | undefined} row */
export function readEvaluation(row) {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.repository_id !== "string" ||
    typeof row.normalized_url !== "string" ||
    typeof row.base_selector_type !== "string" ||
    typeof row.base_selector_value !== "string" ||
    typeof row.head_selector_type !== "string" ||
    typeof row.head_selector_value !== "string" ||
    typeof row.base_commit !== "string" ||
    typeof row.head_commit !== "string" ||
    !["automatic", "explicit"].includes(
      /** @type {string} */ (row.resource_provenance),
    ) ||
    !(
      (row.resource_provenance === "explicit" &&
        row.automatic_pull_request_number === null) ||
      (row.resource_provenance === "automatic" &&
        Number.isSafeInteger(row.automatic_pull_request_number) &&
        /** @type {number} */ (row.automatic_pull_request_number) > 0)
    ) ||
    typeof row.execution_status !== "string" ||
    !(
      row.next_attempt_at === null || Number.isSafeInteger(row.next_attempt_at)
    ) ||
    !Number.isSafeInteger(row.created_at)
  ) {
    throw new TypeError("Evaluation row is invalid");
  }
  const completedAt =
    row.completed_at === null ? null : /** @type {number} */ (row.completed_at);
  const outcome =
    row.result_outcome === null
      ? "pending"
      : /** @type {string} */ (row.result_outcome);
  return {
    base_commit: row.base_commit,
    base_selector: {
      type: row.base_selector_type,
      value: row.base_selector_value,
    },
    completed_at: completedAt === null ? null : timestamp(completedAt),
    created_at: timestamp(/** @type {number} */ (row.created_at)),
    effective_outcome: outcome,
    execution_status: row.execution_status,
    head_commit: row.head_commit,
    head_selector: {
      type: row.head_selector_type,
      value: row.head_selector_value,
    },
    id: row.id,
    next_attempt_at:
      row.next_attempt_at === null
        ? null
        : timestamp(/** @type {number} */ (row.next_attempt_at)),
    provenance: row.resource_provenance,
    ...(row.resource_provenance === "automatic"
      ? {
          pull_request: {
            number: /** @type {number} */ (row.automatic_pull_request_number),
          },
        }
      : {}),
    repository: { id: row.repository_id, url: row.normalized_url },
  };
}

export const EVALUATION_SELECTION = `SELECT evaluations.*, repositories.normalized_url,
  CASE WHEN github_automatic_evaluations.evaluation_id IS NULL
    THEN evaluations.provenance ELSE 'automatic' END AS resource_provenance,
  github_automatic_evaluations.pull_request_number
    AS automatic_pull_request_number,
  evaluation_results.outcome AS result_outcome FROM evaluations
  JOIN repositories ON repositories.id = evaluations.repository_id
  LEFT JOIN github_automatic_evaluations
    ON github_automatic_evaluations.evaluation_id = evaluations.id
  LEFT JOIN evaluation_results ON evaluation_results.evaluation_id = evaluations.id`;
