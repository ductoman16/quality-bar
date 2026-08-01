import { EVALUATION_WAIVER_SELECTION } from "./evaluation-waiver-selection.js";
import { EVALUATION_PRE_START_RETRY_SELECTION } from "./evaluation-pre-start-retry-resource.js";

export const EVALUATION_SELECTION = `${EVALUATION_WAIVER_SELECTION}
  ${EVALUATION_PRE_START_RETRY_SELECTION}
  COALESCE(forgejo_commit_statuses.evaluation_id, github_commit_statuses.evaluation_id) AS commit_status_evaluation_id,
  COALESCE(forgejo_commit_statuses.head_commit, github_commit_statuses.head_commit) AS commit_status_head_commit,
  COALESCE(forgejo_commit_statuses.desired_state, github_commit_statuses.desired_state) AS commit_status_state,
  COALESCE(forgejo_commit_statuses.publication_status, github_commit_statuses.publication_status) AS commit_status_publication_status,
  COALESCE(forgejo_commit_statuses.published_at, github_commit_statuses.published_at) AS commit_status_published_at,
  COALESCE(forgejo_commit_statuses.error_code, github_commit_statuses.error_code) AS commit_status_error_code,
  COALESCE(forgejo_commit_statuses.error_detail, github_commit_statuses.error_detail) AS commit_status_error_detail,
  COALESCE(
    status_delivery.source_id,
    CASE WHEN forgejo_commit_statuses.evaluation_id IS NOT NULL
      THEN forgejo_commit_statuses.evaluation_id || ':' || forgejo_commit_statuses.desired_state
    END
  ) AS commit_status_source_identity,
  COALESCE(
    status_delivery.connection_id,
    forgejo_delivery_repository.connection_id,
    CASE WHEN github_commit_statuses.error_code = 'github_connection_retired'
      THEN delivery_repository.connection_id
    END
  ) AS commit_status_connection_identity,
  COALESCE(
    status_delivery.target,
    CASE WHEN forgejo_commit_statuses.evaluation_id IS NOT NULL THEN json_object(
      'context', 'Quality Bar',
      'head', forgejo_commit_statuses.head_commit,
      'repository_id', forgejo_delivery_repository.forge_repository_id,
      'state', forgejo_commit_statuses.desired_state
    ) END
  ) AS commit_status_target,
  CASE WHEN forgejo_commit_statuses.evaluation_id IS NOT NULL
    THEN CASE WHEN forgejo_commit_statuses.publication_status = 'succeeded' THEN 1 ELSE 0 END
    ELSE status_delivery.attempt_count
  END AS commit_status_attempt_count,
  CASE WHEN forgejo_commit_statuses.evaluation_id IS NOT NULL
    THEN CASE WHEN forgejo_commit_statuses.publication_status = 'succeeded' THEN forgejo_commit_statuses.published_at ELSE NULL END
    ELSE status_delivery.last_attempt_at
  END AS commit_status_last_attempt_at,
  CASE WHEN forgejo_commit_statuses.evaluation_id IS NOT NULL THEN 0 ELSE status_delivery.next_attempt_at END AS commit_status_delivery_next_attempt_at,
  CASE WHEN forgejo_commit_statuses.evaluation_id IS NOT NULL THEN 0 ELSE status_delivery.reconciliation_required END AS commit_status_reconciliation_required,
  COALESCE(forgejo_commit_statuses.external_id, status_delivery.external_id) AS commit_status_external_id,
  status_delivery.error_code AS commit_status_delivery_error_code,
  status_delivery.error_detail AS commit_status_delivery_error_detail,
  CASE WHEN forgejo_commit_statuses.evaluation_id IS NOT NULL THEN NULL ELSE delivery_gate.gate_until END AS commit_status_provider_gate_until,
  CASE WHEN forgejo_commit_statuses.evaluation_id IS NOT NULL THEN NULL ELSE delivery_gate.error_code END AS commit_status_provider_gate_error_code,
  CASE WHEN forgejo_commit_statuses.evaluation_id IS NOT NULL THEN NULL ELSE delivery_gate.error_detail END AS commit_status_provider_gate_error_detail,
  COALESCE(forgejo_feedback_bundles.evaluation_id, github_feedback_bundles.evaluation_id) AS feedback_evaluation_id,
  COALESCE(forgejo_feedback_bundles.publication_status, github_feedback_bundles.publication_status) AS feedback_publication_status,
  COALESCE(forgejo_feedback_bundles.external_id, github_feedback_bundles.external_id) AS feedback_external_id,
  COALESCE(forgejo_feedback_bundles.published_at, github_feedback_bundles.published_at) AS feedback_published_at,
  COALESCE(forgejo_feedback_bundles.error_code, github_feedback_bundles.error_code) AS feedback_error_code,
  COALESCE(forgejo_feedback_bundles.error_detail, github_feedback_bundles.error_detail) AS feedback_error_detail,
  COALESCE(
    aggregate_delivery.source_id,
    CASE WHEN forgejo_feedback_bundles.evaluation_id IS NOT NULL THEN forgejo_feedback_bundles.evaluation_id END
  ) AS feedback_source_identity,
  COALESCE(
    aggregate_delivery.connection_id,
    forgejo_delivery_repository.connection_id,
    CASE WHEN github_feedback_bundles.error_code = 'github_connection_retired'
      THEN delivery_repository.connection_id
    END
  ) AS feedback_connection_identity,
  COALESCE(
    aggregate_delivery.target,
    CASE WHEN forgejo_feedback_bundles.evaluation_id IS NOT NULL THEN json_object(
      'pull_request_number', forgejo_automatic_evaluations.pull_request_number,
      'repository_id', forgejo_delivery_repository.forge_repository_id
    ) END
  ) AS feedback_target,
  CASE WHEN forgejo_feedback_bundles.evaluation_id IS NOT NULL
    THEN CASE WHEN forgejo_feedback_bundles.publication_status = 'succeeded' THEN 1 ELSE 0 END
    ELSE aggregate_delivery.attempt_count
  END AS feedback_attempt_count,
  CASE WHEN forgejo_feedback_bundles.evaluation_id IS NOT NULL
    THEN CASE WHEN forgejo_feedback_bundles.publication_status = 'succeeded' THEN forgejo_feedback_bundles.published_at ELSE NULL END
    ELSE aggregate_delivery.last_attempt_at
  END AS feedback_last_attempt_at,
  CASE WHEN forgejo_feedback_bundles.evaluation_id IS NOT NULL THEN 0 ELSE aggregate_delivery.next_attempt_at END AS feedback_delivery_next_attempt_at,
  CASE WHEN forgejo_feedback_bundles.evaluation_id IS NOT NULL THEN 0 ELSE aggregate_delivery.reconciliation_required END AS feedback_reconciliation_required,
  aggregate_delivery.error_code AS feedback_delivery_error_code,
  aggregate_delivery.error_detail AS feedback_delivery_error_detail,
  CASE WHEN forgejo_feedback_bundles.evaluation_id IS NOT NULL THEN NULL ELSE delivery_gate.gate_until END AS feedback_provider_gate_until,
  CASE WHEN forgejo_feedback_bundles.evaluation_id IS NOT NULL THEN NULL ELSE delivery_gate.error_code END AS feedback_provider_gate_error_code,
  CASE WHEN forgejo_feedback_bundles.evaluation_id IS NOT NULL THEN NULL ELSE delivery_gate.error_detail END AS feedback_provider_gate_error_detail,
  CASE WHEN COALESCE(forgejo_feedback_bundles.evaluation_id, github_feedback_bundles.evaluation_id) IS NULL THEN NULL ELSE (
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
      'connection_identity', connection_identity,
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
             COALESCE(inline_delivery.connection_id, CASE WHEN github_finding_feedback.error_code = 'github_connection_retired' THEN delivery_repository.connection_id END) AS connection_identity,
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
       AND inline_delivery.source_id = github_finding_feedback.finding_id
      WHERE github_finding_feedback.evaluation_id = evaluations.id
      UNION ALL
      SELECT forgejo_finding_feedback.finding_id,
             forgejo_finding_feedback.publication_status,
             forgejo_finding_feedback.external_id,
             forgejo_finding_feedback.published_at,
             forgejo_finding_feedback.error_code,
             forgejo_finding_feedback.error_detail,
             forgejo_finding_feedback.finding_id AS source_identity,
             forgejo_delivery_repository.connection_id AS connection_identity,
             CASE WHEN forgejo_finding_feedback.publication_status = 'aggregate_only'
               THEN 'aggregate_only'
               ELSE json_object(
                 'commit_id', evaluations.head_commit,
                 'line', forgejo_finding_feedback.line,
                 'path', forgejo_finding_feedback.path,
                 'side', forgejo_finding_feedback.side,
                 'start_line', forgejo_finding_feedback.start_line,
                 'start_side', forgejo_finding_feedback.start_side,
                 'pull_request_number', forgejo_automatic_evaluations.pull_request_number,
                 'repository_id', forgejo_delivery_repository.forge_repository_id
               )
             END AS target,
             CASE WHEN forgejo_finding_feedback.publication_status = 'succeeded' THEN 1 ELSE 0 END AS attempt_count,
             CASE WHEN forgejo_finding_feedback.publication_status = 'succeeded' THEN forgejo_finding_feedback.published_at ELSE NULL END AS last_attempt_at,
             0 AS delivery_next_attempt_at,
             0 AS reconciliation_required,
             NULL AS delivery_error_code,
             NULL AS delivery_error_detail,
             NULL AS provider_gate_until,
             NULL AS provider_gate_error_code,
             NULL AS provider_gate_error_detail
      FROM forgejo_finding_feedback
      WHERE forgejo_finding_feedback.evaluation_id = evaluations.id
      ORDER BY finding_id
    )
  ) END AS finding_feedback_json
  FROM evaluations
  JOIN repositories ON repositories.id = evaluations.repository_id
  LEFT JOIN github_automatic_evaluations
    ON github_automatic_evaluations.evaluation_id = evaluations.id
  LEFT JOIN forgejo_automatic_evaluations
    ON forgejo_automatic_evaluations.evaluation_id = evaluations.id
  LEFT JOIN evaluation_results ON evaluation_results.evaluation_id = evaluations.id
  LEFT JOIN github_commit_statuses
    ON github_commit_statuses.evaluation_id = evaluations.id
  LEFT JOIN forgejo_commit_statuses
    ON forgejo_commit_statuses.evaluation_id = evaluations.id
  LEFT JOIN github_delivery_attempts AS status_delivery
    ON status_delivery.surface = 'commit_status'
   AND status_delivery.source_id =
         github_commit_statuses.evaluation_id || ':' ||
         github_commit_statuses.desired_state
  LEFT JOIN github_feedback_bundles
    ON github_feedback_bundles.evaluation_id = evaluations.id
  LEFT JOIN forgejo_feedback_bundles
    ON forgejo_feedback_bundles.evaluation_id = evaluations.id
  LEFT JOIN github_delivery_attempts AS aggregate_delivery
    ON aggregate_delivery.surface = 'aggregate_feedback'
   AND aggregate_delivery.source_id = github_feedback_bundles.evaluation_id
  LEFT JOIN github_repositories AS delivery_repository
    ON delivery_repository.repository_id = evaluations.repository_id
  LEFT JOIN forgejo_repositories AS forgejo_delivery_repository
    ON forgejo_delivery_repository.repository_id = evaluations.repository_id
  LEFT JOIN github_delivery_provider_gates AS delivery_gate
    ON delivery_gate.connection_id = delivery_repository.connection_id`;
