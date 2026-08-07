/** @param {Record<string, any>} [overrides] */
export function systemDeliveryRow(overrides = {}) {
  return {
    adjudication_id: null,
    attempt_count: null,
    connection_id: "connection-1",
    decision_id: null,
    decision_request_finding_id: null,
    definitive: null,
    delivery_connection_id: null,
    delivery_error_code: null,
    delivery_error_detail: null,
    error_code: null,
    error_detail: null,
    evaluation_id: "evaluation-1",
    evaluation_repository_id: "repository-1",
    external_id: null,
    finding_id: null,
    last_attempt_at: null,
    next_attempt_at: null,
    owner_kind: "evaluation",
    publication_error_code: null,
    publication_error_detail: null,
    publication_external_id: null,
    publication_published_at: null,
    publication_status: "waiting",
    provider_gate_error_code: null,
    provider_gate_error_detail: null,
    provider_gate_until: null,
    reconciliation_required: null,
    repository_id: "repository-1",
    source_identity: "evaluation-1",
    surface: "commit_status",
    target: "{}",
    followup_evaluation_id: null,
    adjudication_evaluation_id: null,
    finding_evaluation_id: null,
    ...overrides,
  };
}

/** @param {any} row */
export function fakeGitHubDeliveryCore(row) {
  return {
    /** @param {string} query */
    all(query) {
      if (query.includes("forgejo_")) {
        return [];
      }
      if (query.includes("SELECT 'commit_status' AS surface")) {
        return [row];
      }
      if (
        query.includes("LEFT JOIN evaluations") ||
        query.includes(
          "SELECT surface, source_id FROM github_delivery_attempts",
        )
      ) {
        return [];
      }
      if (
        query.includes(
          "SELECT evaluation_id, desired_state FROM github_commit_statuses",
        )
      ) {
        return [{ evaluation_id: row.evaluation_id, desired_state: "pending" }];
      }
      if (query.includes("SELECT evaluations.id AS evaluation_id")) {
        return [];
      }
      if (query.includes("SELECT surface, source_id, target")) {
        return [];
      }
      if (query.includes("SELECT evaluation_id FROM github_feedback_bundles")) {
        return [{ evaluation_id: row.evaluation_id }];
      }
      if (query.includes("SELECT finding_id FROM github_finding_feedback")) {
        return [{ finding_id: row.finding_id ?? "finding-inline" }];
      }
      return [row];
    },
  };
}

/** @param {any} core @param {string} base @param {string} head */
export function addWaiverFollowupFacts(core, base, head) {
  core.run(
    `INSERT INTO waiver_requests (
       id, evaluation_id, finding_id, rationale, requester_channel, created_at
     ) VALUES ('request-1', 'evaluation-1', 'finding-inline', 'Need a durable waiver review.', 'browser_session', 4)`,
  );
  core.run(
    `INSERT INTO waiver_adjudications (
       id, evaluation_id, base_commit, head_commit, model,
       reasoning_effort, service_tier, execution_status, created_at
     ) VALUES ('adjudication-1', 'evaluation-1', ?, ?, 'gpt-5.6-terra', 'high', 'standard', 'running', 4)`,
    base,
    head,
  );
  core.run(
    "INSERT INTO waiver_adjudication_requests (waiver_adjudication_id, waiver_request_id, position) VALUES ('adjudication-1', 'request-1', 1)",
  );
  core.run(
    "INSERT INTO waiver_decisions (id, waiver_adjudication_id, waiver_request_id, outcome, explanation, created_at) VALUES ('decision-1', 'adjudication-1', 'request-1', 'accepted', 'Accepted for the advisory finding.', 6)",
  );
  core.run(
    "UPDATE waiver_adjudications SET execution_status = 'completed', started_at = 5, completed_at = 6 WHERE id = 'adjudication-1'",
  );
  core.run(
    `INSERT OR IGNORE INTO forgejo_waiver_adjudication_followups (
       waiver_adjudication_id, evaluation_id, outcome, publication_status
     ) VALUES ('adjudication-1', 'evaluation-1', 'advisory', 'waiting')`,
  );
  core.run(
    `INSERT INTO forgejo_waiver_decision_followups (
       waiver_decision_id, waiver_adjudication_id, finding_id,
       original_external_id, path, side, line, publication_status
     ) VALUES ('decision-1', 'adjudication-1', 'finding-inline', 1,
       'src/example.js', 'RIGHT', 2, 'waiting')`,
  );
}
