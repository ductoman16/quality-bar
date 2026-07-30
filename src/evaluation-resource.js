import { effectiveEvaluationOutcome } from "./waiver-effective-outcome.js";
import { githubDeliveryResource as delivery } from "./github-delivery-resource.js";

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
    ![
      row.active_waiver_adjudication_count,
      row.blocking_finding_count,
      row.current_waiver_error_count,
      row.unwaived_advisory_finding_count,
    ].every(Number.isSafeInteger) ||
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
  const effectiveOutcome = effectiveEvaluationOutcome({
    activeAdjudicationCount: /** @type {number} */ (
      row.active_waiver_adjudication_count
    ),
    blockingFindingCount: /** @type {number} */ (row.blocking_finding_count),
    currentWaiverErrorCount: /** @type {number} */ (
      row.current_waiver_error_count
    ),
    resultOutcome: outcome,
    unwaivedAdvisoryFindingCount: /** @type {number} */ (
      row.unwaived_advisory_finding_count
    ),
  });
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
    row.commit_status_error_code === null &&
    row.commit_status_delivery_error_code === null
      ? null
      : {
          code:
            row.commit_status_error_code ??
            row.commit_status_delivery_error_code,
          detail:
            row.commit_status_error_detail ??
            row.commit_status_delivery_error_detail,
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
    row.feedback_error_code === null &&
    row.feedback_delivery_error_code === null
      ? null
      : {
          code: row.feedback_error_code ?? row.feedback_delivery_error_code,
          detail:
            row.feedback_error_detail ?? row.feedback_delivery_error_detail,
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
            ...delivery({
              attempt_count: row.commit_status_attempt_count,
              delivery_next_attempt_at:
                row.commit_status_delivery_next_attempt_at,
              last_attempt_at: row.commit_status_last_attempt_at,
              provider_gate_until:
                row.commit_status_publication_status === "waiting"
                  ? row.commit_status_provider_gate_until
                  : null,
              provider_gate_error_code:
                row.commit_status_publication_status === "waiting"
                  ? row.commit_status_provider_gate_error_code
                  : null,
              provider_gate_error_detail:
                row.commit_status_publication_status === "waiting"
                  ? row.commit_status_provider_gate_error_detail
                  : null,
              reconciliation_required:
                row.commit_status_reconciliation_required,
              source_identity: row.commit_status_source_identity,
              target: row.commit_status_target,
            }),
            context: "Quality Bar",
            error: commitStatusError,
            external_id: row.commit_status_external_id,
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
              ...delivery({
                attempt_count: row.feedback_attempt_count,
                delivery_next_attempt_at: row.feedback_delivery_next_attempt_at,
                last_attempt_at: row.feedback_last_attempt_at,
                provider_gate_until:
                  row.feedback_publication_status === "waiting"
                    ? row.feedback_provider_gate_until
                    : null,
                provider_gate_error_code:
                  row.feedback_publication_status === "waiting"
                    ? row.feedback_provider_gate_error_code
                    : null,
                provider_gate_error_detail:
                  row.feedback_publication_status === "waiting"
                    ? row.feedback_provider_gate_error_detail
                    : null,
                reconciliation_required: row.feedback_reconciliation_required,
                source_identity: row.feedback_source_identity,
                target: row.feedback_target,
              }),
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
              ...(item.publication_status === "aggregate_only"
                ? {
                    attempt_count: 0,
                    last_attempt_at: null,
                    next_attempt_at: null,
                    provider_gate_until: null,
                    provider_gate_error: null,
                    reconciliation_required: false,
                    source_identity: item.finding_id,
                    target: "aggregate_only",
                  }
                : delivery({
                    attempt_count: item.attempt_count,
                    delivery_next_attempt_at: item.delivery_next_attempt_at,
                    last_attempt_at: item.last_attempt_at,
                    provider_gate_until:
                      item.publication_status === "waiting"
                        ? item.provider_gate_until
                        : null,
                    provider_gate_error_code:
                      item.publication_status === "waiting"
                        ? item.provider_gate_error_code
                        : null,
                    provider_gate_error_detail:
                      item.publication_status === "waiting"
                        ? item.provider_gate_error_detail
                        : null,
                    reconciliation_required: item.reconciliation_required,
                    source_identity: item.source_identity,
                    target: item.target,
                  })),
              error:
                item.error_code === null && item.delivery_error_code === null
                  ? null
                  : {
                      code: item.error_code ?? item.delivery_error_code,
                      detail: item.error_detail ?? item.delivery_error_detail,
                    },
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
    effective_outcome: effectiveOutcome,
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

export const EVALUATION_SELECTION = `WITH evaluation_finding_impacts AS (
  SELECT findings.id, findings.evaluation_id,
         review_version_criteria.impact
  FROM findings
  JOIN review_runs ON review_runs.id = findings.review_run_id
  JOIN review_version_criteria
    ON review_version_criteria.review_version_id =
         review_runs.review_version_id
   AND review_version_criteria.criterion_id = findings.criterion_id
)
SELECT evaluations.*, repositories.normalized_url,
  CASE WHEN github_automatic_evaluations.evaluation_id IS NULL
    THEN evaluations.provenance ELSE 'automatic' END AS resource_provenance,
  github_automatic_evaluations.pull_request_number
    AS automatic_pull_request_number,
  evaluation_results.outcome AS result_outcome,
  (
    SELECT count(*) FROM waiver_adjudications
    WHERE waiver_adjudications.evaluation_id = evaluations.id
      AND waiver_adjudications.execution_status IN ('queued', 'running')
  ) AS active_waiver_adjudication_count,
  (
    SELECT count(*)
    FROM evaluation_finding_impacts
    WHERE evaluation_finding_impacts.evaluation_id = evaluations.id
      AND evaluation_finding_impacts.impact = 'blocking'
  ) AS blocking_finding_count,
  (
    SELECT count(*)
    FROM waiver_requests
    WHERE waiver_requests.evaluation_id = evaluations.id
      AND (
        SELECT CASE
          WHEN current_adjudication.execution_status IN ('failed', 'cancelled')
            THEN 1
          WHEN current_adjudication.execution_status = 'completed'
            AND (
              SELECT waiver_decisions.outcome
              FROM waiver_decisions
              WHERE waiver_decisions.waiver_adjudication_id =
                      current_adjudication.id
                AND waiver_decisions.waiver_request_id = waiver_requests.id
              ORDER BY waiver_decisions.rowid DESC
              LIMIT 1
            ) = 'error'
            THEN 1
          ELSE 0
        END
        FROM waiver_adjudication_requests
        JOIN waiver_adjudications AS current_adjudication
          ON current_adjudication.id =
               waiver_adjudication_requests.waiver_adjudication_id
        WHERE waiver_adjudication_requests.waiver_request_id =
                waiver_requests.id
        ORDER BY current_adjudication.rowid DESC
        LIMIT 1
      ) = 1
  ) AS current_waiver_error_count,
  (
    SELECT count(*)
    FROM evaluation_finding_impacts
    WHERE evaluation_finding_impacts.evaluation_id = evaluations.id
      AND evaluation_finding_impacts.impact = 'advisory'
      AND NOT EXISTS (
        SELECT 1
        FROM waiver_requests
        WHERE waiver_requests.finding_id = evaluation_finding_impacts.id
          AND (
            SELECT waiver_decisions.outcome
            FROM waiver_decisions
            WHERE waiver_decisions.waiver_request_id = waiver_requests.id
            ORDER BY waiver_decisions.rowid DESC
            LIMIT 1
          ) = 'accepted'
      )
  ) AS unwaived_advisory_finding_count,
  github_commit_statuses.evaluation_id AS commit_status_evaluation_id,
  github_commit_statuses.head_commit AS commit_status_head_commit,
  github_commit_statuses.desired_state AS commit_status_state,
  github_commit_statuses.publication_status
    AS commit_status_publication_status,
  github_commit_statuses.published_at AS commit_status_published_at,
  github_commit_statuses.error_code AS commit_status_error_code,
  github_commit_statuses.error_detail AS commit_status_error_detail,
  status_delivery.source_id AS commit_status_source_identity,
  status_delivery.target AS commit_status_target,
  status_delivery.attempt_count AS commit_status_attempt_count,
  status_delivery.last_attempt_at AS commit_status_last_attempt_at,
  status_delivery.next_attempt_at AS commit_status_delivery_next_attempt_at,
  status_delivery.reconciliation_required
    AS commit_status_reconciliation_required,
  status_delivery.external_id AS commit_status_external_id,
  status_delivery.error_code AS commit_status_delivery_error_code,
  status_delivery.error_detail AS commit_status_delivery_error_detail,
  delivery_gate.gate_until AS commit_status_provider_gate_until,
  delivery_gate.error_code AS commit_status_provider_gate_error_code,
  delivery_gate.error_detail AS commit_status_provider_gate_error_detail,
  github_feedback_bundles.evaluation_id AS feedback_evaluation_id,
  github_feedback_bundles.publication_status
    AS feedback_publication_status,
  github_feedback_bundles.external_id AS feedback_external_id,
  github_feedback_bundles.published_at AS feedback_published_at,
  github_feedback_bundles.error_code AS feedback_error_code,
  github_feedback_bundles.error_detail AS feedback_error_detail,
  aggregate_delivery.source_id AS feedback_source_identity,
  aggregate_delivery.target AS feedback_target,
  aggregate_delivery.attempt_count AS feedback_attempt_count,
  aggregate_delivery.last_attempt_at AS feedback_last_attempt_at,
  aggregate_delivery.next_attempt_at AS feedback_delivery_next_attempt_at,
  aggregate_delivery.reconciliation_required
    AS feedback_reconciliation_required,
  aggregate_delivery.error_code AS feedback_delivery_error_code,
  aggregate_delivery.error_detail AS feedback_delivery_error_detail,
  delivery_gate.gate_until AS feedback_provider_gate_until,
  delivery_gate.error_code AS feedback_provider_gate_error_code,
  delivery_gate.error_detail AS feedback_provider_gate_error_detail,
  CASE WHEN github_feedback_bundles.evaluation_id IS NULL THEN NULL ELSE (
    SELECT json_group_array(json_object(
      'finding_id', finding_id,
      'publication_status', publication_status,
      'external_id', external_id,
      'published_at', published_at,
      'error_code', error_code,
      'error_detail', error_detail,
      'source_identity', source_identity,
      'target', target,
      'attempt_count', attempt_count,
      'last_attempt_at', last_attempt_at,
      'delivery_next_attempt_at', delivery_next_attempt_at,
      'reconciliation_required', reconciliation_required,
      'delivery_error_code', delivery_error_code,
      'delivery_error_detail', delivery_error_detail,
      'provider_gate_until', provider_gate_until,
      'provider_gate_error_code', provider_gate_error_code,
      'provider_gate_error_detail', provider_gate_error_detail
    ))
    FROM (
      SELECT github_finding_feedback.finding_id,
             github_finding_feedback.publication_status,
             github_finding_feedback.external_id,
             github_finding_feedback.published_at,
             github_finding_feedback.error_code,
             github_finding_feedback.error_detail,
             inline_delivery.source_id AS source_identity,
             inline_delivery.target,
             inline_delivery.attempt_count,
             inline_delivery.last_attempt_at,
             inline_delivery.next_attempt_at AS delivery_next_attempt_at,
             inline_delivery.reconciliation_required,
             inline_delivery.error_code AS delivery_error_code,
             inline_delivery.error_detail AS delivery_error_detail,
             delivery_gate.gate_until AS provider_gate_until,
             delivery_gate.error_code AS provider_gate_error_code,
             delivery_gate.error_detail AS provider_gate_error_detail
      FROM github_finding_feedback
      LEFT JOIN github_delivery_attempts AS inline_delivery
        ON inline_delivery.surface = 'inline_feedback'
       AND inline_delivery.source_id =
             github_finding_feedback.finding_id
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
  LEFT JOIN github_delivery_attempts AS status_delivery
    ON status_delivery.surface = 'commit_status'
   AND status_delivery.source_id =
         github_commit_statuses.evaluation_id || ':' ||
         github_commit_statuses.desired_state
  LEFT JOIN github_feedback_bundles
    ON github_feedback_bundles.evaluation_id = evaluations.id
  LEFT JOIN github_delivery_attempts AS aggregate_delivery
    ON aggregate_delivery.surface = 'aggregate_feedback'
   AND aggregate_delivery.source_id =
         github_feedback_bundles.evaluation_id
  LEFT JOIN github_repositories AS delivery_repository
    ON delivery_repository.repository_id = evaluations.repository_id
  LEFT JOIN github_delivery_provider_gates AS delivery_gate
    ON delivery_gate.connection_id = delivery_repository.connection_id`;
