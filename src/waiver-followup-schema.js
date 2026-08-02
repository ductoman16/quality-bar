const PUBLICATION_COLUMNS = `
  publication_status TEXT NOT NULL CHECK (
    publication_status IN ('waiting', 'succeeded', 'unavailable')
  ),
  external_id INTEGER CHECK (external_id IS NULL OR external_id > 0),
  published_at INTEGER,
  error_code TEXT,
  error_detail TEXT,
  CHECK (
    (publication_status = 'waiting'
      AND external_id IS NULL AND published_at IS NULL
      AND error_code IS NULL AND error_detail IS NULL)
    OR (publication_status = 'succeeded'
      AND external_id IS NOT NULL AND published_at IS NOT NULL
      AND error_code IS NULL AND error_detail IS NULL)
    OR (publication_status = 'unavailable'
      AND external_id IS NULL AND published_at IS NULL
      AND error_code IS NOT NULL AND length(error_code) > 0
      AND error_detail IS NOT NULL AND length(trim(error_detail)) > 0)
  )`;

export const WAIVER_FOLLOWUP_REBUILD_CLEANUP = `
  DROP TRIGGER IF EXISTS waiver_followup_status_pending;
  DROP TRIGGER IF EXISTS waiver_followup_status_finish;
  ${["github", "forgejo"]
    .flatMap((provider) => [
      `${provider}_waiver_adjudication_followup_identity`,
      `${provider}_waiver_adjudication_followup_delete`,
      `${provider}_waiver_adjudication_followup_publication`,
      `${provider}_waiver_decision_followup_identity`,
      `${provider}_waiver_decision_followup_delete`,
      `${provider}_waiver_decision_followup_publication`,
      `${provider}_waiver_followup_admit`,
      `${provider}_waiver_local_followup_after_inline`,
    ])
    .map((name) => `DROP TRIGGER IF EXISTS ${name};`)
    .join("\n")}
`;

/** @param {"forgejo" | "github"} provider */
const STATUS_ON_START = (provider) => `
  UPDATE ${provider}_commit_statuses
  SET desired_state = 'pending', publication_status = 'waiting',
      published_state = NULL, published_at = NULL,
      ${provider === "forgejo" ? "external_id = NULL," : ""}
      error_code = NULL, error_detail = NULL
  WHERE evaluation_id = NEW.evaluation_id
    AND head_commit = NEW.head_commit
    AND error_code IS NOT '${provider}_connection_retired';`;

const EFFECTIVE_OUTCOME = `CASE
  WHEN NEW.execution_status IN ('failed', 'cancelled') THEN 'error'
  WHEN (SELECT outcome FROM evaluation_results
        WHERE evaluation_id = NEW.evaluation_id) = 'error' THEN 'error'
  WHEN EXISTS (
    SELECT 1 FROM waiver_requests
    WHERE waiver_requests.evaluation_id = NEW.evaluation_id
      AND (
        SELECT CASE
          WHEN current_adjudication.execution_status IN ('failed', 'cancelled')
            THEN 1
          WHEN current_adjudication.execution_status = 'completed'
            AND waiver_decisions.outcome = 'error' THEN 1
          ELSE 0
        END
        FROM waiver_adjudication_requests
        JOIN waiver_adjudications AS current_adjudication
          ON current_adjudication.id =
               waiver_adjudication_requests.waiver_adjudication_id
        LEFT JOIN waiver_decisions
          ON waiver_decisions.waiver_adjudication_id = current_adjudication.id
         AND waiver_decisions.waiver_request_id = waiver_requests.id
        WHERE waiver_adjudication_requests.waiver_request_id = waiver_requests.id
        ORDER BY current_adjudication.rowid DESC
        LIMIT 1
      ) = 1
  ) THEN 'error'
  WHEN EXISTS (
    SELECT 1 FROM findings
    JOIN review_runs ON review_runs.id = findings.review_run_id
    JOIN review_version_criteria
      ON review_version_criteria.review_version_id = review_runs.review_version_id
     AND review_version_criteria.criterion_id = findings.criterion_id
    WHERE findings.evaluation_id = NEW.evaluation_id
      AND review_version_criteria.impact = 'blocking'
  ) THEN 'blocking'
  WHEN EXISTS (
    SELECT 1 FROM findings
    JOIN review_runs ON review_runs.id = findings.review_run_id
    JOIN review_version_criteria
      ON review_version_criteria.review_version_id = review_runs.review_version_id
     AND review_version_criteria.criterion_id = findings.criterion_id
    WHERE findings.evaluation_id = NEW.evaluation_id
      AND review_version_criteria.impact = 'advisory'
      AND NOT EXISTS (
        SELECT 1 FROM waiver_requests
        WHERE waiver_requests.finding_id = findings.id
          AND (SELECT waiver_decisions.outcome
               FROM waiver_decisions
               WHERE waiver_decisions.waiver_request_id = waiver_requests.id
               ORDER BY waiver_decisions.rowid DESC LIMIT 1) = 'accepted'
      )
  ) THEN 'advisory'
  ELSE 'clear'
END`;

/** @param {"forgejo" | "github"} provider */
const STATUS_ON_FINISH = (provider) => `
  UPDATE ${provider}_commit_statuses
  SET desired_state = CASE ${EFFECTIVE_OUTCOME}
        WHEN 'clear' THEN 'success'
        WHEN 'advisory' THEN 'failure'
        WHEN 'blocking' THEN 'failure'
        WHEN 'error' THEN 'error'
      END,
      publication_status = 'waiting', published_state = NULL,
      published_at = NULL,
      ${provider === "forgejo" ? "external_id = NULL," : ""}
      error_code = NULL, error_detail = NULL
  WHERE evaluation_id = NEW.evaluation_id
    AND head_commit = NEW.head_commit
    AND error_code IS NOT '${provider}_connection_retired';`;

/** @param {"forgejo" | "github"} provider */
const FOLLOWUP_TABLES = (provider) => `
  CREATE TABLE IF NOT EXISTS ${provider}_waiver_adjudication_followups (
    waiver_adjudication_id TEXT PRIMARY KEY REFERENCES waiver_adjudications(id),
    evaluation_id TEXT NOT NULL REFERENCES evaluation_results(evaluation_id),
    outcome TEXT NOT NULL CHECK (
      outcome IN ('clear', 'advisory', 'blocking', 'error')
    ),
    ${PUBLICATION_COLUMNS}
  ) STRICT;
  CREATE TABLE IF NOT EXISTS ${provider}_waiver_decision_followups (
    waiver_decision_id TEXT PRIMARY KEY REFERENCES waiver_decisions(id),
    waiver_adjudication_id TEXT NOT NULL
      REFERENCES ${provider}_waiver_adjudication_followups(waiver_adjudication_id),
    finding_id TEXT NOT NULL REFERENCES findings(id),
    original_external_id INTEGER NOT NULL CHECK (original_external_id > 0),
    ${
      provider === "forgejo"
        ? `path TEXT NOT NULL CHECK (length(path) > 0),
    side TEXT NOT NULL CHECK (side IN ('LEFT', 'RIGHT')),
    start_line INTEGER CHECK (start_line IS NULL OR start_line > 0),
    start_side TEXT CHECK (start_side IN ('LEFT', 'RIGHT')),
    line INTEGER NOT NULL CHECK (line > 0),`
        : ""
    }
    ${PUBLICATION_COLUMNS}
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS ${provider}_waiver_adjudication_followup_identity
    BEFORE UPDATE OF waiver_adjudication_id, evaluation_id, outcome
    ON ${provider}_waiver_adjudication_followups
    BEGIN SELECT RAISE(ABORT, '${provider}_waiver_followup_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS ${provider}_waiver_adjudication_followup_delete
    BEFORE DELETE ON ${provider}_waiver_adjudication_followups
    BEGIN SELECT RAISE(ABORT, '${provider}_waiver_followup_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS ${provider}_waiver_adjudication_followup_publication
    BEFORE UPDATE OF publication_status, external_id, published_at,
      error_code, error_detail
    ON ${provider}_waiver_adjudication_followups
    WHEN NOT ((OLD.publication_status = 'waiting'
      AND NEW.publication_status IN ('succeeded', 'unavailable'))
      OR (OLD.publication_status = 'unavailable'
        AND NEW.publication_status = 'waiting'
        AND NEW.external_id IS NULL AND NEW.published_at IS NULL
        AND NEW.error_code IS NULL AND NEW.error_detail IS NULL))
    BEGIN SELECT RAISE(ABORT, '${provider}_waiver_followup_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS ${provider}_waiver_decision_followup_identity
    BEFORE UPDATE OF waiver_decision_id, waiver_adjudication_id, finding_id,
      original_external_id${provider === "forgejo" ? ", path, side, start_line, start_side, line" : ""}
    ON ${provider}_waiver_decision_followups
    BEGIN SELECT RAISE(ABORT, '${provider}_waiver_followup_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS ${provider}_waiver_decision_followup_delete
    BEFORE DELETE ON ${provider}_waiver_decision_followups
    BEGIN SELECT RAISE(ABORT, '${provider}_waiver_followup_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS ${provider}_waiver_decision_followup_publication
    BEFORE UPDATE OF publication_status, external_id, published_at,
      error_code, error_detail
    ON ${provider}_waiver_decision_followups
    WHEN NOT ((OLD.publication_status = 'waiting'
      AND NEW.publication_status IN ('succeeded', 'unavailable'))
      OR (OLD.publication_status = 'unavailable'
        AND NEW.publication_status = 'waiting'
        AND NEW.external_id IS NULL AND NEW.published_at IS NULL
        AND NEW.error_code IS NULL AND NEW.error_detail IS NULL))
    BEGIN SELECT RAISE(ABORT, '${provider}_waiver_followup_immutable'); END;`;

/** @param {"forgejo" | "github"} provider @param {string} retiredCode */
const FOLLOWUP_ADMISSION = (provider, retiredCode) => `
  CREATE TRIGGER IF NOT EXISTS ${provider}_waiver_followup_admit
    AFTER UPDATE OF execution_status ON waiver_adjudications
    WHEN NEW.execution_status = 'completed'
    BEGIN
      INSERT INTO ${provider}_waiver_adjudication_followups (
        waiver_adjudication_id, evaluation_id, outcome, publication_status,
        error_code, error_detail
      )
      SELECT NEW.id, NEW.evaluation_id, ${EFFECTIVE_OUTCOME},
             CASE connections.lifecycle WHEN 'retired' THEN 'unavailable' ELSE 'waiting' END,
             CASE connections.lifecycle WHEN 'retired' THEN '${retiredCode}' ELSE NULL END,
             CASE connections.lifecycle WHEN 'retired' THEN
               '${provider === "github" ? "GitHub" : "Forgejo"} waiver follow-up publication is unavailable because the ${provider === "github" ? "GitHub" : "Forgejo"} Connection is retired'
               ELSE NULL END
      FROM ${provider}_automatic_evaluations AS automatic
      JOIN ${provider}_repositories AS repositories
        ON repositories.repository_id = automatic.repository_id
      JOIN ${provider}_connections AS connections
        ON connections.id = repositories.connection_id
      WHERE automatic.evaluation_id = NEW.evaluation_id;

      INSERT INTO ${provider}_waiver_decision_followups (
        waiver_decision_id, waiver_adjudication_id, finding_id,
        original_external_id,
        ${provider === "forgejo" ? "path, side, start_line, start_side, line," : ""}
        publication_status, error_code, error_detail
      )
      SELECT decisions.id, NEW.id, requests.finding_id,
             feedback.external_id,
             ${provider === "forgejo" ? "feedback.path, feedback.side, feedback.start_line, feedback.start_side, feedback.line," : ""}
             CASE aggregate.publication_status
               WHEN 'unavailable' THEN 'unavailable' ELSE 'waiting' END,
             CASE aggregate.publication_status
               WHEN 'unavailable' THEN aggregate.error_code ELSE NULL END,
             CASE aggregate.publication_status
               WHEN 'unavailable' THEN aggregate.error_detail ELSE NULL END
      FROM waiver_decisions AS decisions
      JOIN waiver_requests AS requests ON requests.id = decisions.waiver_request_id
      JOIN ${provider}_finding_feedback AS feedback
        ON feedback.finding_id = requests.finding_id
       AND feedback.publication_status = 'succeeded'
      JOIN ${provider}_waiver_adjudication_followups AS aggregate
        ON aggregate.waiver_adjudication_id = NEW.id
      WHERE decisions.waiver_adjudication_id = NEW.id
        AND decisions.outcome = 'accepted';
    END;
  CREATE TRIGGER IF NOT EXISTS ${provider}_waiver_local_followup_after_inline
    AFTER UPDATE OF publication_status ON ${provider}_finding_feedback
    WHEN NEW.publication_status = 'succeeded'
    BEGIN
      INSERT INTO ${provider}_waiver_decision_followups (
        waiver_decision_id, waiver_adjudication_id, finding_id,
        original_external_id,
        ${provider === "forgejo" ? "path, side, start_line, start_side, line," : ""}
        publication_status, error_code, error_detail
      )
      SELECT decisions.id, decisions.waiver_adjudication_id,
             requests.finding_id, NEW.external_id,
             ${provider === "forgejo" ? "NEW.path, NEW.side, NEW.start_line, NEW.start_side, NEW.line," : ""}
             CASE aggregate.publication_status
               WHEN 'unavailable' THEN 'unavailable' ELSE 'waiting' END,
             CASE aggregate.publication_status
               WHEN 'unavailable' THEN aggregate.error_code ELSE NULL END,
             CASE aggregate.publication_status
               WHEN 'unavailable' THEN aggregate.error_detail ELSE NULL END
      FROM waiver_decisions AS decisions
      JOIN waiver_requests AS requests ON requests.id = decisions.waiver_request_id
      JOIN waiver_adjudications AS adjudications
        ON adjudications.id = decisions.waiver_adjudication_id
       AND adjudications.execution_status = 'completed'
      JOIN ${provider}_waiver_adjudication_followups AS aggregate
        ON aggregate.waiver_adjudication_id = decisions.waiver_adjudication_id
      WHERE requests.finding_id = NEW.finding_id
        AND decisions.outcome = 'accepted'
      ON CONFLICT (waiver_decision_id) DO NOTHING;
    END;`;

export const WAIVER_FOLLOWUP_SCHEMA = `
  ${FOLLOWUP_TABLES("github")}
  ${FOLLOWUP_TABLES("forgejo")}
  CREATE TRIGGER IF NOT EXISTS waiver_followup_status_pending
    AFTER UPDATE OF execution_status ON waiver_adjudications
    WHEN OLD.execution_status = 'queued' AND NEW.execution_status = 'running'
    BEGIN
      ${STATUS_ON_START("github")}
      ${STATUS_ON_START("forgejo")}
    END;
  CREATE TRIGGER IF NOT EXISTS waiver_followup_status_finish
    AFTER UPDATE OF execution_status ON waiver_adjudications
    WHEN NEW.execution_status IN ('completed', 'failed', 'cancelled')
      AND OLD.execution_status != NEW.execution_status
    BEGIN
      ${STATUS_ON_FINISH("github")}
      ${STATUS_ON_FINISH("forgejo")}
    END;
  ${FOLLOWUP_ADMISSION("github", "github_connection_retired")}
  ${FOLLOWUP_ADMISSION("forgejo", "forgejo_connection_retired")}
`;
