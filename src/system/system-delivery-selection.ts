import { readCommitDeliverySources } from "./system-delivery-lineage.ts";

function rejectOrphanedDeliveryPublications(
  durableCore: any,
  provider: "github" | "forgejo",
) {
  const checks = [
    `SELECT publication.evaluation_id
       FROM ${provider}_commit_statuses AS publication
       LEFT JOIN evaluations
         ON evaluations.id = publication.evaluation_id
       LEFT JOIN ${provider}_repositories AS repositories
         ON repositories.repository_id = publication.repository_id
      WHERE evaluations.id IS NULL
         OR evaluations.repository_id != publication.repository_id
         OR repositories.repository_id IS NULL`,
    `SELECT publication.evaluation_id
       FROM ${provider}_feedback_bundles AS publication
       LEFT JOIN evaluations
         ON evaluations.id = publication.evaluation_id
       LEFT JOIN ${provider}_automatic_evaluations AS automatic
         ON automatic.evaluation_id = publication.evaluation_id
       LEFT JOIN ${provider}_repositories AS repositories
         ON repositories.repository_id = automatic.repository_id
      WHERE evaluations.id IS NULL
         OR automatic.evaluation_id IS NULL
         OR evaluations.repository_id != automatic.repository_id
         OR repositories.repository_id IS NULL`,
    `SELECT publication.finding_id
       FROM ${provider}_finding_feedback AS publication
       LEFT JOIN findings
         ON findings.id = publication.finding_id
       LEFT JOIN evaluations
         ON evaluations.id = publication.evaluation_id
       LEFT JOIN ${provider}_automatic_evaluations AS automatic
         ON automatic.evaluation_id = publication.evaluation_id
       LEFT JOIN ${provider}_repositories AS repositories
         ON repositories.repository_id = automatic.repository_id
      WHERE findings.id IS NULL
         OR findings.evaluation_id != publication.evaluation_id
         OR evaluations.id IS NULL
         OR automatic.evaluation_id IS NULL
         OR evaluations.repository_id != automatic.repository_id
         OR repositories.repository_id IS NULL`,
    `SELECT followup.waiver_adjudication_id
       FROM ${provider}_waiver_adjudication_followups AS followup
       LEFT JOIN waiver_adjudications AS adjudications
         ON adjudications.id = followup.waiver_adjudication_id
       LEFT JOIN evaluations
         ON evaluations.id = followup.evaluation_id
       LEFT JOIN ${provider}_automatic_evaluations AS automatic
         ON automatic.evaluation_id = followup.evaluation_id
       LEFT JOIN ${provider}_repositories AS repositories
         ON repositories.repository_id = automatic.repository_id
      WHERE adjudications.id IS NULL
         OR adjudications.evaluation_id != followup.evaluation_id
         OR evaluations.id IS NULL
         OR automatic.evaluation_id IS NULL
         OR evaluations.repository_id != automatic.repository_id
         OR repositories.repository_id IS NULL`,
    `SELECT followup.waiver_decision_id
       FROM ${provider}_waiver_decision_followups AS followup
       LEFT JOIN waiver_decisions AS decisions
         ON decisions.id = followup.waiver_decision_id
       LEFT JOIN waiver_requests AS requests
         ON requests.id = decisions.waiver_request_id
       LEFT JOIN waiver_adjudications AS adjudications
         ON adjudications.id = followup.waiver_adjudication_id
       LEFT JOIN findings
         ON findings.id = followup.finding_id
       LEFT JOIN evaluations
         ON evaluations.id = adjudications.evaluation_id
       LEFT JOIN ${provider}_automatic_evaluations AS automatic
         ON automatic.evaluation_id = adjudications.evaluation_id
       LEFT JOIN ${provider}_repositories AS repositories
         ON repositories.repository_id = automatic.repository_id
      WHERE decisions.id IS NULL
         OR decisions.waiver_adjudication_id != followup.waiver_adjudication_id
         OR requests.id IS NULL
         OR requests.finding_id != followup.finding_id
         OR requests.evaluation_id != adjudications.evaluation_id
         OR adjudications.id IS NULL
         OR findings.id IS NULL
         OR findings.evaluation_id != adjudications.evaluation_id
         OR evaluations.id IS NULL
         OR automatic.evaluation_id IS NULL
         OR evaluations.repository_id != automatic.repository_id
         OR repositories.repository_id IS NULL`,
  ];
  if (checks.some((query) => durableCore.all(query).length > 0)) {
    throw new TypeError(`${provider} System delivery publication is orphaned`);
  }
}

function rejectOrphanedDeliveryAttempts(
  durableCore: any,
  provider: "github" | "forgejo",
) {
  const attempts = durableCore.all(
    `SELECT surface, source_id FROM ${provider}_delivery_attempts`,
  );
  const commitSources = readCommitDeliverySources(durableCore, provider);
  const aggregateSources = new Set([
    ...durableCore
      .all(`SELECT evaluation_id FROM ${provider}_feedback_bundles`)
      .map((row: any) => row.evaluation_id),
    ...durableCore
      .all(
        `SELECT waiver_adjudication_id
           FROM ${provider}_waiver_adjudication_followups`,
      )
      .map((row: any) => `waiver-adjudication:${row.waiver_adjudication_id}`),
  ]);
  const inlineSources = new Set([
    ...durableCore
      .all(`SELECT finding_id FROM ${provider}_finding_feedback`)
      .map((row: any) => row.finding_id),
    ...durableCore
      .all(
        `SELECT waiver_decision_id, finding_id
           FROM ${provider}_waiver_decision_followups`,
      )
      .map(
        (row: any) =>
          `waiver-decision:${row.waiver_decision_id}:${row.finding_id}`,
      ),
  ]);
  for (const row of attempts) {
    const sourceId = row?.source_id;
    const valid =
      row?.surface === "commit_status"
        ? typeof sourceId === "string" && commitSources.has(sourceId)
        : row?.surface === "aggregate_feedback"
          ? aggregateSources.has(sourceId)
          : row?.surface === "inline_feedback" && inlineSources.has(sourceId);
    if (!valid) {
      throw new TypeError(`${provider} System delivery attempt is orphaned`);
    }
  }
}

export function readSystemDeliveryRows(
  durableCore: any,
  provider: "github" | "forgejo",
): any[] {
  const github = provider === "github";
  rejectOrphanedDeliveryPublications(durableCore, provider);
  rejectOrphanedDeliveryAttempts(durableCore, provider);
  return durableCore.all(`
    SELECT 'commit_status' AS surface, 'evaluation' AS owner_kind,
           publication.evaluation_id,
           NULL AS adjudication_id, NULL AS decision_id, NULL AS finding_id,
           publication.repository_id,
           repositories.connection_id,
           COALESCE(
             delivery.source_id,
             publication.evaluation_id || ':' || publication.desired_state
           ) AS source_identity,
           CASE WHEN publication.publication_status = 'aggregate_only'
             THEN 'aggregate_only' ELSE delivery.target END AS target,
           publication.publication_status,
           ${github ? "NULL" : "publication.external_id"} AS publication_external_id,
           publication.published_at AS publication_published_at,
           publication.error_code AS publication_error_code,
           publication.error_detail AS publication_error_detail,
           delivery.attempt_count AS attempt_count,
           delivery.last_attempt_at AS last_attempt_at,
           delivery.next_attempt_at AS next_attempt_at,
           delivery.reconciliation_required AS reconciliation_required,
           delivery.external_id,
           delivery.error_code,
           delivery.error_detail,
           delivery.definitive AS definitive,
           gate.gate_until AS provider_gate_until,
           gate.error_code AS provider_gate_error_code,
           gate.error_detail AS provider_gate_error_detail,
           delivery.connection_id AS delivery_connection_id,
           evaluations.repository_id AS evaluation_repository_id,
           NULL AS followup_evaluation_id,
           NULL AS adjudication_evaluation_id,
           NULL AS finding_evaluation_id,
           NULL AS decision_request_finding_id
      FROM ${provider}_commit_statuses AS publication
      JOIN evaluations
        ON evaluations.id = publication.evaluation_id
      JOIN ${provider}_repositories AS repositories
        ON repositories.repository_id = publication.repository_id
      LEFT JOIN ${provider}_delivery_attempts AS delivery
        ON delivery.surface = 'commit_status'
       AND delivery.source_id = publication.evaluation_id || ':' || publication.desired_state
      LEFT JOIN ${provider}_delivery_provider_gates AS gate
        ON gate.connection_id = repositories.connection_id
    UNION ALL
    SELECT 'aggregate_feedback', 'evaluation',
           publication.evaluation_id,
           NULL, NULL, NULL,
           automatic.repository_id,
           repositories.connection_id,
           COALESCE(delivery.source_id, publication.evaluation_id),
           CASE WHEN publication.publication_status = 'aggregate_only'
             THEN 'aggregate_only' ELSE delivery.target END,
           publication.publication_status,
           publication.external_id,
           publication.published_at,
           publication.error_code,
           publication.error_detail,
           delivery.attempt_count,
           delivery.last_attempt_at,
           delivery.next_attempt_at,
           delivery.reconciliation_required,
           delivery.external_id,
           delivery.error_code,
           delivery.error_detail,
           delivery.definitive,
           gate.gate_until,
           gate.error_code,
           gate.error_detail,
           delivery.connection_id,
           evaluations.repository_id,
           NULL,
           NULL,
           NULL,
           NULL
      FROM ${provider}_feedback_bundles AS publication
      JOIN evaluations
        ON evaluations.id = publication.evaluation_id
      JOIN ${provider}_automatic_evaluations AS automatic
        ON automatic.evaluation_id = publication.evaluation_id
      JOIN ${provider}_repositories AS repositories
        ON repositories.repository_id = automatic.repository_id
      LEFT JOIN ${provider}_delivery_attempts AS delivery
        ON delivery.surface = 'aggregate_feedback'
       AND delivery.source_id = publication.evaluation_id
      LEFT JOIN ${provider}_delivery_provider_gates AS gate
        ON gate.connection_id = repositories.connection_id
    UNION ALL
    SELECT 'inline_feedback', 'evaluation',
           publication.evaluation_id,
           NULL, NULL, publication.finding_id,
           automatic.repository_id,
           repositories.connection_id,
           COALESCE(delivery.source_id, publication.finding_id),
           CASE WHEN publication.publication_status = 'aggregate_only'
             THEN 'aggregate_only' ELSE delivery.target END,
           publication.publication_status,
           publication.external_id,
           publication.published_at,
           publication.error_code,
           publication.error_detail,
           delivery.attempt_count,
           delivery.last_attempt_at,
           delivery.next_attempt_at,
           delivery.reconciliation_required,
           delivery.external_id,
           delivery.error_code,
           delivery.error_detail,
           delivery.definitive,
           gate.gate_until,
           gate.error_code,
           gate.error_detail,
           delivery.connection_id,
           evaluations.repository_id,
           NULL,
           NULL,
           findings.evaluation_id,
           NULL
      FROM ${provider}_finding_feedback AS publication
      JOIN evaluations
        ON evaluations.id = publication.evaluation_id
      JOIN findings
        ON findings.id = publication.finding_id
      JOIN ${provider}_automatic_evaluations AS automatic
        ON automatic.evaluation_id = publication.evaluation_id
      JOIN ${provider}_repositories AS repositories
        ON repositories.repository_id = automatic.repository_id
      LEFT JOIN ${provider}_delivery_attempts AS delivery
        ON delivery.surface = 'inline_feedback'
       AND delivery.source_id = publication.finding_id
      LEFT JOIN ${provider}_delivery_provider_gates AS gate
        ON gate.connection_id = repositories.connection_id
    UNION ALL
    SELECT 'aggregate_feedback', 'adjudication',
           followup.evaluation_id,
           followup.waiver_adjudication_id, NULL, NULL,
           automatic.repository_id,
           repositories.connection_id,
           'waiver-adjudication:' || followup.waiver_adjudication_id,
           delivery.target,
           followup.publication_status,
           followup.external_id,
           followup.published_at,
           followup.error_code,
           followup.error_detail,
           delivery.attempt_count,
           delivery.last_attempt_at,
           delivery.next_attempt_at,
           delivery.reconciliation_required,
           delivery.external_id,
           delivery.error_code,
           delivery.error_detail,
           delivery.definitive,
           gate.gate_until,
           gate.error_code,
           gate.error_detail,
           delivery.connection_id,
           evaluations.repository_id,
           followup.evaluation_id,
           adjudications.evaluation_id,
           NULL,
           NULL
      FROM ${provider}_waiver_adjudication_followups AS followup
      LEFT JOIN waiver_adjudications AS adjudications
        ON adjudications.id = followup.waiver_adjudication_id
      LEFT JOIN evaluations
        ON evaluations.id = followup.evaluation_id
      LEFT JOIN ${provider}_automatic_evaluations AS automatic
        ON automatic.evaluation_id = followup.evaluation_id
      LEFT JOIN ${provider}_repositories AS repositories
        ON repositories.repository_id = automatic.repository_id
      LEFT JOIN ${provider}_delivery_attempts AS delivery
        ON delivery.surface = 'aggregate_feedback'
       AND delivery.source_id = 'waiver-adjudication:' || followup.waiver_adjudication_id
      LEFT JOIN ${provider}_delivery_provider_gates AS gate
        ON gate.connection_id = repositories.connection_id
    UNION ALL
    SELECT 'inline_feedback', 'decision',
           adjudications.evaluation_id,
           followup.waiver_adjudication_id, followup.waiver_decision_id,
           followup.finding_id,
           automatic.repository_id,
           repositories.connection_id,
           'waiver-decision:' || followup.waiver_decision_id || ':' || followup.finding_id,
           delivery.target,
           followup.publication_status,
           followup.external_id,
           followup.published_at,
           followup.error_code,
           followup.error_detail,
           delivery.attempt_count,
           delivery.last_attempt_at,
           delivery.next_attempt_at,
           delivery.reconciliation_required,
           delivery.external_id,
           delivery.error_code,
           delivery.error_detail,
           delivery.definitive,
           gate.gate_until,
           gate.error_code,
           gate.error_detail,
           delivery.connection_id,
           evaluations.repository_id,
           NULL,
           adjudications.evaluation_id,
           findings.evaluation_id,
           requests.finding_id
      FROM ${provider}_waiver_decision_followups AS followup
      LEFT JOIN waiver_adjudications AS adjudications
        ON adjudications.id = followup.waiver_adjudication_id
      LEFT JOIN waiver_decisions AS decisions
        ON decisions.id = followup.waiver_decision_id
      LEFT JOIN waiver_requests AS requests
        ON requests.id = decisions.waiver_request_id
      LEFT JOIN findings
        ON findings.id = followup.finding_id
      LEFT JOIN evaluations
        ON evaluations.id = adjudications.evaluation_id
      LEFT JOIN ${provider}_automatic_evaluations AS automatic
        ON automatic.evaluation_id = adjudications.evaluation_id
      LEFT JOIN ${provider}_repositories AS repositories
        ON repositories.repository_id = automatic.repository_id
      LEFT JOIN ${provider}_delivery_attempts AS delivery
        ON delivery.surface = 'inline_feedback'
       AND delivery.source_id = 'waiver-decision:' || followup.waiver_decision_id || ':' || followup.finding_id
      LEFT JOIN ${provider}_delivery_provider_gates AS gate
        ON gate.connection_id = repositories.connection_id
  `);
}
