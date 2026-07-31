import {
  WAIVER_ADJUDICATION_EXECUTION_INTEGRITY,
  WAIVER_ADJUDICATION_TERMINAL_INTEGRITY,
} from "./waiver-adjudication-schema-migration.js";
import { RETRY_SUMMARY_COLUMNS_SQL } from "./retention-schema.js";

export const WAIVER_BATCH_SCHEMA = `
  CREATE TABLE IF NOT EXISTS waiver_adjudications (
    id TEXT PRIMARY KEY,
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    base_commit TEXT NOT NULL,
    head_commit TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    service_tier TEXT NOT NULL,
    execution_status TEXT NOT NULL CHECK (
      execution_status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
    ),
    requests_sealed_at INTEGER,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    error_code TEXT,
    error_detail TEXT,
    codex_cli_version TEXT,
    process_exit_code INTEGER,
    process_signal TEXT,
    input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
    cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
    output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
    execution_evidence_recorded INTEGER NOT NULL DEFAULT 0 CHECK (execution_evidence_recorded IN (0, 1)),
    ${RETRY_SUMMARY_COLUMNS_SQL}
    CHECK (length(base_commit) = length(head_commit)),
    CHECK (requests_sealed_at IS NULL OR requests_sealed_at >= created_at),
    CHECK (
      (execution_status = 'failed'
        AND error_code IS NOT NULL AND length(error_code) > 0
        AND error_code NOT GLOB '*[^a-z0-9_]*'
        AND substr(error_code, 1, 1) GLOB '[a-z]'
        AND error_detail IS NOT NULL AND length(trim(error_detail)) > 0)
      OR
      (execution_status <> 'failed' AND error_code IS NULL AND error_detail IS NULL)
    )
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS waiver_adjudication_active_evaluation
    ON waiver_adjudications (evaluation_id) WHERE execution_status IN ('queued', 'running');
  CREATE TABLE IF NOT EXISTS waiver_requests (
    id TEXT PRIMARY KEY,
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    finding_id TEXT NOT NULL REFERENCES findings(id),
    rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
    requester_channel TEXT NOT NULL CHECK (requester_channel IN ('browser_session', 'implementer_token')),
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS waiver_adjudication_requests (
    waiver_adjudication_id TEXT NOT NULL REFERENCES waiver_adjudications(id),
    waiver_request_id TEXT NOT NULL REFERENCES waiver_requests(id),
    position INTEGER NOT NULL CHECK (position > 0),
    PRIMARY KEY (waiver_adjudication_id, waiver_request_id),
    UNIQUE (waiver_adjudication_id, position)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS waiver_decisions (
    id TEXT PRIMARY KEY,
    waiver_adjudication_id TEXT NOT NULL REFERENCES waiver_adjudications(id),
    waiver_request_id TEXT NOT NULL REFERENCES waiver_requests(id),
    outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'denied', 'error')),
    explanation TEXT,
    error_code TEXT,
    error_detail TEXT,
    created_at INTEGER NOT NULL,
    CHECK (
      (outcome IN ('accepted', 'denied')
        AND explanation IS NOT NULL AND length(trim(explanation)) > 0
        AND error_code IS NULL AND error_detail IS NULL)
      OR
      (outcome = 'error'
        AND explanation IS NULL
        AND error_code IS NOT NULL AND length(error_code) > 0
        AND error_code NOT GLOB '*[^a-z0-9_]*'
        AND substr(error_code, 1, 1) GLOB '[a-z]'
        AND error_detail IS NOT NULL AND length(trim(error_detail)) > 0)
    ),
    UNIQUE (waiver_adjudication_id, waiver_request_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS waiver_adjudication_transcript_chunks (
    waiver_adjudication_id TEXT NOT NULL REFERENCES waiver_adjudications(id),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    stream TEXT NOT NULL CHECK (stream IN ('stdout', 'stderr')),
    content TEXT NOT NULL CHECK (length(content) > 0),
    PRIMARY KEY (waiver_adjudication_id, sequence)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS waiver_batch_idempotency (
    channel TEXT NOT NULL
      CHECK (channel IN ('browser_session', 'implementer_token')),
    route TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL CHECK (response_status = 201),
    response_body TEXT NOT NULL,
    waiver_adjudication_id TEXT NOT NULL REFERENCES waiver_adjudications(id),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (channel, route, idempotency_key)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS waiver_request_immutable_update
    BEFORE UPDATE ON waiver_requests
    BEGIN SELECT RAISE(ABORT, 'waiver_request_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_request_evaluation_insert
    BEFORE INSERT ON waiver_requests
    WHEN NOT EXISTS (
      SELECT 1 FROM findings
      WHERE findings.id = NEW.finding_id
        AND findings.evaluation_id = NEW.evaluation_id
    )
    BEGIN SELECT RAISE(ABORT, 'waiver_request_evaluation_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_request_advisory_insert
    BEFORE INSERT ON waiver_requests
    WHEN NOT EXISTS (
      SELECT 1
      FROM findings
      JOIN review_runs
        ON review_runs.id = findings.review_run_id
      JOIN review_version_criteria
        ON review_version_criteria.review_version_id =
             review_runs.review_version_id
       AND review_version_criteria.criterion_id = findings.criterion_id
      WHERE findings.id = NEW.finding_id
        AND review_version_criteria.impact = 'advisory'
    )
    BEGIN SELECT RAISE(ABORT, 'waiver_request_finding_ineligible'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_request_limit_insert
    BEFORE INSERT ON waiver_requests
    WHEN (
      SELECT count(*) FROM waiver_requests
      WHERE waiver_requests.finding_id = NEW.finding_id
    ) >= 3
    BEGIN SELECT RAISE(ABORT, 'waiver_request_limit_reached'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_request_after_acceptance_insert
    BEFORE INSERT ON waiver_requests
    WHEN EXISTS (
      SELECT 1
      FROM waiver_requests AS accepted_request
      WHERE accepted_request.finding_id = NEW.finding_id
        AND (
          SELECT waiver_decisions.outcome
          FROM waiver_decisions
          JOIN waiver_adjudications
            ON waiver_adjudications.id =
                 waiver_decisions.waiver_adjudication_id
          WHERE waiver_decisions.waiver_request_id = accepted_request.id
          ORDER BY waiver_adjudications.rowid DESC
          LIMIT 1
        ) = 'accepted'
    )
    BEGIN SELECT RAISE(ABORT, 'waiver_request_accepted'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_request_sequence_insert
    BEFORE INSERT ON waiver_requests
    WHEN EXISTS (
      SELECT 1 FROM waiver_requests
      WHERE waiver_requests.finding_id = NEW.finding_id
    )
    AND COALESCE(
      (
        SELECT waiver_decisions.outcome
        FROM waiver_requests AS latest_request
        JOIN waiver_decisions
          ON waiver_decisions.waiver_request_id = latest_request.id
        JOIN waiver_adjudications
          ON waiver_adjudications.id =
               waiver_decisions.waiver_adjudication_id
        WHERE latest_request.id = (
          SELECT waiver_requests.id
          FROM waiver_requests
          WHERE waiver_requests.finding_id = NEW.finding_id
          ORDER BY waiver_requests.rowid DESC
          LIMIT 1
        )
        ORDER BY waiver_adjudications.rowid DESC
        LIMIT 1
      ),
      ''
    ) <> 'denied'
    BEGIN SELECT RAISE(ABORT, 'waiver_request_previous_not_denied'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_request_rationale_revised_insert
    BEFORE INSERT ON waiver_requests
    WHEN EXISTS (
      SELECT 1 FROM waiver_requests
      WHERE waiver_requests.finding_id = NEW.finding_id
        AND trim(waiver_requests.rationale) = trim(NEW.rationale)
    )
    BEGIN SELECT RAISE(ABORT, 'waiver_request_duplicate'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_request_immutable_delete
    BEFORE DELETE ON waiver_requests
    BEGIN SELECT RAISE(ABORT, 'waiver_request_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_identity_immutable
    BEFORE UPDATE OF evaluation_id, base_commit, head_commit, model,
      reasoning_effort, service_tier, created_at
    ON waiver_adjudications
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_evaluation_insert
    BEFORE INSERT ON waiver_adjudications
    WHEN NOT EXISTS (
      SELECT 1 FROM evaluations
      WHERE id = NEW.evaluation_id
        AND base_commit = NEW.base_commit
        AND head_commit = NEW.head_commit
    )
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_evaluation_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_request_seal_update
    BEFORE UPDATE OF requests_sealed_at ON waiver_adjudications
    WHEN OLD.requests_sealed_at IS NOT NULL
      OR NEW.requests_sealed_at IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM codex_execution_queue
        WHERE work_kind = 'waiver_adjudication'
          AND work_id = NEW.id
          AND accepted_at = NEW.requests_sealed_at
      )
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_request_seal_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_queue_reference_delete
    BEFORE DELETE ON waiver_adjudications
    WHEN EXISTS (
      SELECT 1 FROM codex_execution_queue
      WHERE work_kind = 'waiver_adjudication' AND work_id = OLD.id
    )
    BEGIN SELECT RAISE(ABORT, 'codex_execution_queue_reference_in_use'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_request_immutable_update
    BEFORE UPDATE ON waiver_adjudication_requests
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_request_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_request_evaluation_insert
    BEFORE INSERT ON waiver_adjudication_requests
    WHEN NOT EXISTS (
      SELECT 1
      FROM waiver_requests
      JOIN waiver_adjudications
        ON waiver_adjudications.id = NEW.waiver_adjudication_id
      WHERE waiver_requests.id = NEW.waiver_request_id
        AND waiver_requests.evaluation_id = waiver_adjudications.evaluation_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'waiver_adjudication_request_evaluation_invalid');
    END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_request_retry_insert
    BEFORE INSERT ON waiver_adjudication_requests
    WHEN EXISTS (
      SELECT 1 FROM waiver_adjudication_requests
      WHERE waiver_request_id = NEW.waiver_request_id
    )
    AND EXISTS (
      SELECT 1
      FROM waiver_requests
      JOIN waiver_adjudications
        ON waiver_adjudications.id = NEW.waiver_adjudication_id
      WHERE waiver_requests.id = NEW.waiver_request_id
        AND waiver_requests.evaluation_id = waiver_adjudications.evaluation_id
    )
    AND NOT COALESCE((
      (
        SELECT waiver_decisions.outcome
        FROM waiver_adjudication_requests AS prior_association
        JOIN waiver_adjudications
          ON waiver_adjudications.id =
               prior_association.waiver_adjudication_id
        LEFT JOIN waiver_decisions
          ON waiver_decisions.waiver_adjudication_id =
               prior_association.waiver_adjudication_id
         AND waiver_decisions.waiver_request_id =
               prior_association.waiver_request_id
        WHERE prior_association.waiver_request_id = NEW.waiver_request_id
        ORDER BY waiver_adjudications.rowid DESC
        LIMIT 1
      ) = 'error'
      OR
      (
        SELECT
          waiver_decisions.id IS NULL
          AND waiver_adjudications.execution_status IN ('failed', 'cancelled')
        FROM waiver_adjudication_requests AS prior_association
        JOIN waiver_adjudications
          ON waiver_adjudications.id =
               prior_association.waiver_adjudication_id
        LEFT JOIN waiver_decisions
          ON waiver_decisions.waiver_adjudication_id =
               prior_association.waiver_adjudication_id
         AND waiver_decisions.waiver_request_id =
               prior_association.waiver_request_id
        WHERE prior_association.waiver_request_id = NEW.waiver_request_id
        ORDER BY waiver_adjudications.rowid DESC
        LIMIT 1
      )
    ), 0)
    BEGIN SELECT RAISE(ABORT, 'waiver_request_retry_ineligible'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_request_set_frozen_insert
    BEFORE INSERT ON waiver_adjudication_requests
    WHEN (
      SELECT requests_sealed_at FROM waiver_adjudications
      WHERE id = NEW.waiver_adjudication_id
    ) IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'waiver_adjudication_request_set_frozen');
    END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_request_immutable_delete
    BEFORE DELETE ON waiver_adjudication_requests
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_request_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_decision_request_insert
    BEFORE INSERT ON waiver_decisions
    WHEN NOT EXISTS (
      SELECT 1
      FROM waiver_adjudication_requests
      JOIN waiver_adjudications
        ON waiver_adjudications.id =
           waiver_adjudication_requests.waiver_adjudication_id
      WHERE waiver_adjudication_requests.waiver_adjudication_id =
            NEW.waiver_adjudication_id
        AND waiver_adjudication_requests.waiver_request_id =
            NEW.waiver_request_id
        AND waiver_adjudications.execution_status = 'running'
    )
    BEGIN SELECT RAISE(ABORT, 'waiver_decision_request_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_decision_immutable_update
    BEFORE UPDATE ON waiver_decisions
    BEGIN SELECT RAISE(ABORT, 'waiver_decision_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_decision_immutable_delete
    BEFORE DELETE ON waiver_decisions
    BEGIN SELECT RAISE(ABORT, 'waiver_decision_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_transcript_immutable_update
    BEFORE UPDATE ON waiver_adjudication_transcript_chunks
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_transcript_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_transcript_immutable_delete
    BEFORE DELETE ON waiver_adjudication_transcript_chunks
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_transcript_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_transcript_requires_started
    BEFORE INSERT ON waiver_adjudication_transcript_chunks
    WHEN (
      SELECT started_at FROM waiver_adjudications
      WHERE id = NEW.waiver_adjudication_id
    ) IS NULL
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_not_started'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_complete_decisions
    BEFORE UPDATE OF execution_status ON waiver_adjudications
    WHEN (NEW.execution_status = 'completed'
      AND (SELECT count(*) FROM waiver_decisions
           WHERE waiver_adjudication_id = NEW.id) <> (SELECT count(*)
             FROM waiver_adjudication_requests
             WHERE waiver_adjudication_id = NEW.id)) OR (
      NEW.execution_status = 'failed'
      AND EXISTS (SELECT 1 FROM waiver_decisions
                  WHERE waiver_adjudication_id = NEW.id)
    )
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_decisions_invalid'); END;
  ${WAIVER_ADJUDICATION_TERMINAL_INTEGRITY}
  ${WAIVER_ADJUDICATION_EXECUTION_INTEGRITY}
  CREATE TRIGGER IF NOT EXISTS waiver_batch_idempotency_immutable_update
    BEFORE UPDATE ON waiver_batch_idempotency
    BEGIN SELECT RAISE(ABORT, 'waiver_batch_idempotency_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_batch_idempotency_immutable_delete
    BEFORE DELETE ON waiver_batch_idempotency
    BEGIN SELECT RAISE(ABORT, 'waiver_batch_idempotency_immutable'); END;
`;

export const WAIVER_QUEUE_MIGRATION = `
  DROP INDEX IF EXISTS codex_execution_queue_ready;
  DROP INDEX IF EXISTS codex_execution_queue_worker;
  DROP TRIGGER IF EXISTS codex_execution_queue_identity_update;
  DROP TRIGGER IF EXISTS codex_execution_queue_reference_insert;
  DROP TRIGGER IF EXISTS codex_execution_queue_waiver_requests_insert;
  DROP TRIGGER IF EXISTS codex_execution_queue_waiver_lifecycle_insert;
  DROP TRIGGER IF EXISTS codex_execution_queue_waiver_seal_insert;
  DROP TRIGGER IF EXISTS codex_execution_queue_waiver_active_delete;
  DROP TRIGGER IF EXISTS review_run_queue_reference_delete;
  DROP TRIGGER IF EXISTS waiver_adjudication_queue_reference_delete;
  DROP TRIGGER IF EXISTS codex_execution_queue_claim_insert;
  DROP TRIGGER IF EXISTS codex_execution_queue_claim_update;
  ALTER TABLE codex_execution_queue RENAME TO codex_execution_queue_v34;
  CREATE TABLE codex_execution_queue (
    work_id TEXT PRIMARY KEY,
    work_kind TEXT NOT NULL
      CHECK (work_kind IN ('review_run', 'waiver_adjudication')),
    ready_at INTEGER NOT NULL,
    accepted_at INTEGER NOT NULL,
    started_at INTEGER,
    retry_state TEXT NOT NULL DEFAULT 'ready'
      CHECK (retry_state IN ('ready', 'exhausted')),
    worker_id TEXT CHECK (worker_id IS NULL OR length(worker_id) > 0),
    fencing_token INTEGER NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
    lease_expires_at INTEGER,
    CHECK (
      (worker_id IS NULL AND lease_expires_at IS NULL AND fencing_token = 0)
      OR
      (worker_id IS NOT NULL AND lease_expires_at IS NOT NULL AND fencing_token > 0)
    ),
    CHECK (started_at IS NULL OR started_at >= accepted_at)
  ) STRICT;
  INSERT INTO codex_execution_queue (
    work_id, work_kind, ready_at, accepted_at, started_at,
    retry_state, worker_id, fencing_token, lease_expires_at
  )
  SELECT work_id, work_kind, ready_at, accepted_at, started_at,
         retry_state, worker_id, fencing_token, lease_expires_at
  FROM codex_execution_queue_v34;
  DROP TABLE codex_execution_queue_v34;
`;
