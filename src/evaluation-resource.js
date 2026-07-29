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
  const hasCommitStatus = row.commit_status_evaluation_id !== null;
  if (
    hasCommitStatus &&
    (row.commit_status_evaluation_id !== row.id ||
      row.commit_status_head_commit !== row.head_commit ||
      !["pending", "success", "failure", "error"].includes(
        /** @type {string} */ (row.commit_status_state),
      ) ||
      !["waiting", "succeeded", "unavailable"].includes(
        /** @type {string} */ (row.commit_status_publication_status),
      ))
  ) {
    throw new TypeError("Evaluation commit status row is invalid");
  }
  const commitStatusError =
    row.commit_status_error_code === null
      ? null
      : {
          code: row.commit_status_error_code,
          detail: row.commit_status_error_detail,
        };
  const hasFeedback = row.feedback_evaluation_id !== null;
  let findingFeedback = [];
  if (hasFeedback) {
    if (
      row.feedback_evaluation_id !== row.id ||
      !["waiting", "succeeded", "unavailable"].includes(
        /** @type {string} */ (row.feedback_publication_status),
      ) ||
      typeof row.finding_feedback_json !== "string"
    ) {
      throw new TypeError("Evaluation GitHub feedback row is invalid");
    }
    try {
      findingFeedback = JSON.parse(row.finding_feedback_json);
    } catch {
      throw new TypeError("Evaluation GitHub Finding feedback is invalid");
    }
    if (
      !Array.isArray(findingFeedback) ||
      findingFeedback.some(
        (item) =>
          typeof item?.finding_id !== "string" ||
          !["aggregate_only", "waiting", "succeeded", "unavailable"].includes(
            item.publication_status,
          ) ||
          !(
            item.external_id === null || Number.isSafeInteger(item.external_id)
          ) ||
          !(
            item.published_at === null ||
            Number.isSafeInteger(item.published_at)
          ) ||
          !(
            item.error_code === null ||
            (typeof item.error_code === "string" &&
              typeof item.error_detail === "string")
          ),
      )
    ) {
      throw new TypeError("Evaluation GitHub Finding feedback is invalid");
    }
  }
  const feedbackError =
    row.feedback_error_code === null
      ? null
      : {
          code: row.feedback_error_code,
          detail: row.feedback_error_detail,
        };
  return {
    base_commit: row.base_commit,
    base_selector: {
      type: row.base_selector_type,
      value: row.base_selector_value,
    },
    completed_at: completedAt === null ? null : timestamp(completedAt),
    ...(hasCommitStatus
      ? {
          commit_status: {
            context: "Quality Bar",
            error: commitStatusError,
            head_commit: row.commit_status_head_commit,
            publication_status: row.commit_status_publication_status,
            published_at:
              row.commit_status_published_at === null
                ? null
                : timestamp(
                    /** @type {number} */ (row.commit_status_published_at),
                  ),
            state: row.commit_status_state,
          },
        }
      : {}),
    ...(hasFeedback
      ? {
          feedback: {
            aggregate: {
              error: feedbackError,
              external_id: row.feedback_external_id,
              publication_status: row.feedback_publication_status,
              published_at:
                row.feedback_published_at === null
                  ? null
                  : timestamp(
                      /** @type {number} */ (row.feedback_published_at),
                    ),
            },
            findings: findingFeedback.map((item) => ({
              error:
                item.error_code === null
                  ? null
                  : { code: item.error_code, detail: item.error_detail },
              external_id: item.external_id,
              finding_id: item.finding_id,
              publication_status: item.publication_status,
              published_at:
                item.published_at === null
                  ? null
                  : timestamp(item.published_at),
            })),
          },
        }
      : {}),
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
  evaluation_results.outcome AS result_outcome,
  github_commit_statuses.evaluation_id AS commit_status_evaluation_id,
  github_commit_statuses.head_commit AS commit_status_head_commit,
  github_commit_statuses.desired_state AS commit_status_state,
  github_commit_statuses.publication_status
    AS commit_status_publication_status,
  github_commit_statuses.published_at AS commit_status_published_at,
  github_commit_statuses.error_code AS commit_status_error_code,
  github_commit_statuses.error_detail AS commit_status_error_detail,
  github_feedback_bundles.evaluation_id AS feedback_evaluation_id,
  github_feedback_bundles.publication_status
    AS feedback_publication_status,
  github_feedback_bundles.external_id AS feedback_external_id,
  github_feedback_bundles.published_at AS feedback_published_at,
  github_feedback_bundles.error_code AS feedback_error_code,
  github_feedback_bundles.error_detail AS feedback_error_detail,
  CASE WHEN github_feedback_bundles.evaluation_id IS NULL THEN NULL ELSE (
    SELECT json_group_array(json_object(
      'finding_id', finding_id,
      'publication_status', publication_status,
      'external_id', external_id,
      'published_at', published_at,
      'error_code', error_code,
      'error_detail', error_detail
    ))
    FROM (
      SELECT finding_id, publication_status, external_id, published_at,
             error_code, error_detail
      FROM github_finding_feedback
      WHERE evaluation_id = evaluations.id
      ORDER BY finding_id
    )
  ) END AS finding_feedback_json
  FROM evaluations
  JOIN repositories ON repositories.id = evaluations.repository_id
  LEFT JOIN github_automatic_evaluations
    ON github_automatic_evaluations.evaluation_id = evaluations.id
  LEFT JOIN evaluation_results ON evaluation_results.evaluation_id = evaluations.id
  LEFT JOIN github_commit_statuses
    ON github_commit_statuses.evaluation_id = evaluations.id
  LEFT JOIN github_feedback_bundles
    ON github_feedback_bundles.evaluation_id = evaluations.id`;
