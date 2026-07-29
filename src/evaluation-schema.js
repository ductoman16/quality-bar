import { REVIEW_RUN_EVIDENCE_SCHEMA } from "./review-run-evidence.js";
import { APPLICABILITY_RESULT_SCHEMA } from "./applicability-result-schema.js";
import { APPLICABILITY_SEAL_SCHEMA } from "./applicability-seal-schema.js";
import {
  EVALUATION_FILE_CHANGE_SCHEMA,
  EVALUATION_FILE_CHANGE_TRIGGERS,
} from "./evaluation-file-change-schema.js";
import {
  EVALUATION_CANCELLATION_CHECK,
  EVALUATION_CANCELLATION_COLUMNS,
  EVALUATION_CANCELLATION_TRIGGERS,
} from "./evaluation-cancellation-schema.js";
import { GITHUB_AUTOMATIC_EVALUATION_SCHEMA } from "./github-automatic-evaluation-schema.js";

export { EVALUATION_FILE_CHANGE_KIND_MIGRATION } from "./evaluation-file-change-schema.js";
export { evaluationCancellationMigration } from "./evaluation-cancellation-schema.js";

export const EVALUATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS evaluations (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repositories(id),
    provenance TEXT NOT NULL CHECK (provenance = 'explicit'),
    base_selector_type TEXT NOT NULL CHECK (base_selector_type IN ('branch', 'commit')),
    base_selector_value TEXT NOT NULL,
    head_selector_type TEXT NOT NULL CHECK (head_selector_type IN ('branch', 'commit')),
    head_selector_value TEXT NOT NULL,
    base_commit TEXT NOT NULL CHECK (
      length(base_commit) IN (40, 64)
      AND base_commit NOT GLOB '*[^0-9a-f]*'
    ),
    head_commit TEXT NOT NULL CHECK (
      length(head_commit) IN (40, 64)
      AND head_commit NOT GLOB '*[^0-9a-f]*'
    ),
    execution_status TEXT NOT NULL
      CHECK (execution_status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    applicability_sealed_at INTEGER,
    ${EVALUATION_CANCELLATION_COLUMNS}
    next_attempt_at INTEGER,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    CHECK (length(base_commit) = length(head_commit)),
    CHECK (next_attempt_at IS NULL OR execution_status = 'queued'),
    CHECK (applicability_sealed_at IS NULL OR applicability_sealed_at >= created_at),
    ${EVALUATION_CANCELLATION_CHECK}
  ) STRICT;
  CREATE INDEX IF NOT EXISTS evaluations_newest
    ON evaluations (created_at DESC, id DESC);
  ${GITHUB_AUTOMATIC_EVALUATION_SCHEMA}
  CREATE TABLE IF NOT EXISTS evaluation_results (
    evaluation_id TEXT PRIMARY KEY REFERENCES evaluations(id),
    outcome TEXT NOT NULL
      CHECK (outcome IN ('clear', 'advisory', 'blocking', 'error')),
    completed_at INTEGER NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS review_versions_applicability_identity
    ON review_versions (id, review_id);
  ${APPLICABILITY_RESULT_SCHEMA}
  CREATE TABLE IF NOT EXISTS evaluation_idempotency (
    channel TEXT NOT NULL
      CHECK (channel IN ('browser_session', 'implementer_token', 'mcp')),
    route TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (channel, route, idempotency_key)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS review_runs (
    id TEXT PRIMARY KEY,
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    review_id TEXT NOT NULL REFERENCES reviews(id),
    review_version_id TEXT NOT NULL REFERENCES review_versions(id),
    execution_status TEXT NOT NULL CHECK (
      execution_status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
    ),
    started_at INTEGER,
    completed_at INTEGER,
    error_code TEXT,
    error_detail TEXT,
    codex_cli_version TEXT,
    process_exit_code INTEGER,
    process_signal TEXT,
    input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
    cached_input_tokens INTEGER
      CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
    output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
    execution_evidence_recorded INTEGER NOT NULL DEFAULT 0
      CHECK (execution_evidence_recorded IN (0, 1)),
    created_at INTEGER NOT NULL,
    CHECK (started_at IS NULL OR started_at >= created_at),
    CHECK (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at)),
    CHECK (
      (execution_status = 'failed'
        AND error_code IS NOT NULL AND length(error_code) > 0
        AND error_code NOT GLOB '*[^a-z0-9_]*'
        AND substr(error_code, 1, 1) GLOB '[a-z]'
        AND error_detail IS NOT NULL AND length(trim(error_detail)) > 0)
      OR
      (execution_status <> 'failed' AND error_code IS NULL AND error_detail IS NULL)
    ),
    UNIQUE (evaluation_id, review_id)
  ) STRICT;
  ${REVIEW_RUN_EVIDENCE_SCHEMA}
  CREATE TABLE IF NOT EXISTS criterion_results (
    review_run_id TEXT NOT NULL REFERENCES review_runs(id),
    criterion_id TEXT NOT NULL REFERENCES criteria(id),
    outcome TEXT NOT NULL
      CHECK (outcome IN ('clear', 'triggered', 'not_applicable', 'error')),
    error_code TEXT,
    error_detail TEXT,
    CHECK (
      (outcome = 'error'
        AND error_code IS NOT NULL AND length(error_code) > 0
        AND error_code NOT GLOB '*[^a-z0-9_]*'
        AND substr(error_code, 1, 1) GLOB '[a-z]'
        AND error_detail IS NOT NULL AND length(trim(error_detail)) > 0)
      OR
      (outcome <> 'error' AND error_code IS NULL AND error_detail IS NULL)
    ),
    PRIMARY KEY (review_run_id, criterion_id)
  ) STRICT;
  ${EVALUATION_FILE_CHANGE_SCHEMA}
  CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    review_run_id TEXT NOT NULL,
    criterion_id TEXT NOT NULL,
    evidence TEXT NOT NULL CHECK (length(trim(evidence)) > 0),
    remediation TEXT NOT NULL CHECK (length(trim(remediation)) > 0),
    location_kind TEXT NOT NULL
      CHECK (location_kind IN ('line_range', 'whole_side', 'changeset')),
    file_change_id TEXT,
    side TEXT CHECK (side IN ('base', 'head')),
    start_line INTEGER CHECK (start_line IS NULL OR start_line > 0),
    end_line INTEGER CHECK (end_line IS NULL OR end_line >= start_line),
    FOREIGN KEY (review_run_id, criterion_id)
      REFERENCES criterion_results(review_run_id, criterion_id),
    FOREIGN KEY (evaluation_id, file_change_id)
      REFERENCES evaluation_file_changes(evaluation_id, id),
    CHECK (
      (location_kind = 'changeset'
        AND file_change_id IS NULL AND side IS NULL
        AND start_line IS NULL AND end_line IS NULL)
      OR
      (location_kind = 'whole_side'
        AND file_change_id IS NOT NULL AND side IS NOT NULL
        AND start_line IS NULL AND end_line IS NULL)
      OR
      (location_kind = 'line_range'
        AND file_change_id IS NOT NULL AND side IS NOT NULL
        AND start_line IS NOT NULL AND end_line IS NOT NULL)
    )
  ) STRICT;
  CREATE TABLE IF NOT EXISTS codex_execution_queue (
    work_id TEXT PRIMARY KEY REFERENCES review_runs(id),
    work_kind TEXT NOT NULL
      CHECK (work_kind = 'review_run'),
    ready_at INTEGER NOT NULL,
    accepted_at INTEGER NOT NULL,
    started_at INTEGER,
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
  CREATE INDEX IF NOT EXISTS codex_execution_queue_ready
    ON codex_execution_queue (started_at, ready_at, work_id);
  CREATE UNIQUE INDEX IF NOT EXISTS codex_execution_queue_worker
    ON codex_execution_queue (worker_id)
    WHERE worker_id IS NOT NULL;
  CREATE TRIGGER IF NOT EXISTS evaluation_frozen_identity_update
    BEFORE UPDATE OF
      repository_id,
      provenance,
      base_selector_type,
      base_selector_value,
      head_selector_type,
      head_selector_value,
      base_commit,
      head_commit,
      created_at
    ON evaluations
    BEGIN SELECT RAISE(ABORT, 'evaluation_identity_immutable'); END;
  ${EVALUATION_CANCELLATION_TRIGGERS}
  ${APPLICABILITY_SEAL_SCHEMA}
  CREATE TRIGGER IF NOT EXISTS evaluation_result_immutable_update
    BEFORE UPDATE ON evaluation_results
    BEGIN SELECT RAISE(ABORT, 'evaluation_result_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS evaluation_result_immutable_delete
    BEFORE DELETE ON evaluation_results
    BEGIN SELECT RAISE(ABORT, 'evaluation_result_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS evaluation_idempotency_immutable_update
    BEFORE UPDATE ON evaluation_idempotency
    BEGIN SELECT RAISE(ABORT, 'evaluation_idempotency_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS evaluation_idempotency_immutable_delete
    BEFORE DELETE ON evaluation_idempotency
    BEGIN SELECT RAISE(ABORT, 'evaluation_idempotency_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS review_run_version_matches_review
    BEFORE INSERT ON review_runs
    WHEN (
      SELECT review_id FROM review_versions WHERE id = NEW.review_version_id
    ) <> NEW.review_id
    BEGIN SELECT RAISE(ABORT, 'review_run_version_mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS review_run_frozen_identity_update
    BEFORE UPDATE OF
      evaluation_id,
      review_id,
      review_version_id,
      created_at
    ON review_runs
    BEGIN SELECT RAISE(ABORT, 'review_run_identity_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS review_run_failure_update
    BEFORE UPDATE OF execution_status, error_code, error_detail
    ON review_runs
    WHEN (
      (NEW.execution_status = 'failed'
        AND (
          NEW.error_code IS NULL OR length(NEW.error_code) = 0
          OR NEW.error_code GLOB '*[^a-z0-9_]*'
          OR substr(NEW.error_code, 1, 1) NOT GLOB '[a-z]'
          OR NEW.error_detail IS NULL OR length(trim(NEW.error_detail)) = 0
          OR EXISTS (
            SELECT 1 FROM criterion_results
            WHERE review_run_id = NEW.id
          )
        ))
      OR
      (NEW.execution_status <> 'failed'
        AND (NEW.error_code IS NOT NULL OR NEW.error_detail IS NOT NULL))
    )
    BEGIN SELECT RAISE(ABORT, 'review_run_failure_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS criterion_result_immutable_update
    BEFORE UPDATE ON criterion_results
    BEGIN SELECT RAISE(ABORT, 'criterion_result_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS criterion_result_immutable_delete
    BEFORE DELETE ON criterion_results
    BEGIN SELECT RAISE(ABORT, 'criterion_result_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS criterion_result_requires_running_review_run
    BEFORE INSERT ON criterion_results
    WHEN (
      SELECT execution_status FROM review_runs
      WHERE id = NEW.review_run_id
    ) <> 'running'
    BEGIN SELECT RAISE(ABORT, 'criterion_result_review_run_not_running'); END;
  ${EVALUATION_FILE_CHANGE_TRIGGERS}
  CREATE TRIGGER IF NOT EXISTS finding_immutable_update
    BEFORE UPDATE ON findings
    BEGIN SELECT RAISE(ABORT, 'finding_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS finding_immutable_delete
    BEFORE DELETE ON findings
    BEGIN SELECT RAISE(ABORT, 'finding_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS finding_requires_triggered_criterion
    BEFORE INSERT ON findings
    WHEN (
      SELECT outcome FROM criterion_results
      WHERE review_run_id = NEW.review_run_id
        AND criterion_id = NEW.criterion_id
    ) <> 'triggered'
    BEGIN SELECT RAISE(ABORT, 'finding_result_mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_identity_update
    BEFORE UPDATE OF work_id, work_kind, accepted_at
    ON codex_execution_queue
    BEGIN SELECT RAISE(ABORT, 'codex_execution_queue_identity_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_claim_insert
    BEFORE INSERT ON codex_execution_queue
    WHEN (
      (NEW.worker_id IS NULL) <> (NEW.lease_expires_at IS NULL)
      OR (NEW.worker_id IS NULL AND NEW.fencing_token <> 0)
      OR (NEW.worker_id IS NOT NULL AND NEW.fencing_token <= 0)
    )
    BEGIN SELECT RAISE(ABORT, 'review_run_claim_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_claim_update
    BEFORE UPDATE OF worker_id, fencing_token, lease_expires_at
    ON codex_execution_queue
    WHEN (
      (NEW.worker_id IS NULL) <> (NEW.lease_expires_at IS NULL)
      OR (NEW.worker_id IS NULL AND NEW.fencing_token <> 0)
      OR (NEW.worker_id IS NOT NULL AND NEW.fencing_token <= 0)
      OR (
        NEW.worker_id IS NOT OLD.worker_id
        AND NEW.fencing_token <= OLD.fencing_token
      )
    )
    BEGIN SELECT RAISE(ABORT, 'review_run_claim_invalid'); END;
`;

export const FINDING_RESULT_MIGRATION = `
  DROP TRIGGER IF EXISTS review_run_failure_update;
  DROP TRIGGER IF EXISTS finding_requires_triggered_criterion;
  DROP TRIGGER criterion_result_immutable_update;
  DROP TRIGGER criterion_result_immutable_delete;
  ALTER TABLE criterion_results RENAME TO criterion_results_v27;
  CREATE TABLE criterion_results (
    review_run_id TEXT NOT NULL REFERENCES review_runs(id),
    criterion_id TEXT NOT NULL REFERENCES criteria(id),
    outcome TEXT NOT NULL
      CHECK (outcome IN ('clear', 'triggered', 'not_applicable', 'error')),
    error_code TEXT,
    error_detail TEXT,
    CHECK (
      (outcome = 'error'
        AND error_code IS NOT NULL AND length(error_code) > 0
        AND error_code NOT GLOB '*[^a-z0-9_]*'
        AND substr(error_code, 1, 1) GLOB '[a-z]'
        AND error_detail IS NOT NULL AND length(trim(error_detail)) > 0)
      OR
      (outcome <> 'error' AND error_code IS NULL AND error_detail IS NULL)
    ),
    PRIMARY KEY (review_run_id, criterion_id)
  ) STRICT;
  INSERT INTO criterion_results (
    review_run_id, criterion_id, outcome, error_code, error_detail
  )
  SELECT review_run_id, criterion_id, outcome, NULL, NULL
  FROM criterion_results_v27;
  DROP TABLE criterion_results_v27;
`;

export const CRITERION_RESULT_MEANING_MIGRATION = `
  DROP TRIGGER IF EXISTS review_run_failure_update;
  DROP TRIGGER IF EXISTS finding_requires_triggered_criterion;
  DROP TRIGGER finding_immutable_update;
  DROP TRIGGER finding_immutable_delete;
  ALTER TABLE findings RENAME TO findings_v28;
  DROP TRIGGER criterion_result_immutable_update;
  DROP TRIGGER criterion_result_immutable_delete;
  ALTER TABLE criterion_results RENAME TO criterion_results_v28;
  CREATE TABLE criterion_results (
    review_run_id TEXT NOT NULL REFERENCES review_runs(id),
    criterion_id TEXT NOT NULL REFERENCES criteria(id),
    outcome TEXT NOT NULL
      CHECK (outcome IN ('clear', 'triggered', 'not_applicable', 'error')),
    error_code TEXT,
    error_detail TEXT,
    CHECK (
      (outcome = 'error'
        AND error_code IS NOT NULL AND length(error_code) > 0
        AND error_code NOT GLOB '*[^a-z0-9_]*'
        AND substr(error_code, 1, 1) GLOB '[a-z]'
        AND error_detail IS NOT NULL AND length(trim(error_detail)) > 0)
      OR
      (outcome <> 'error' AND error_code IS NULL AND error_detail IS NULL)
    ),
    PRIMARY KEY (review_run_id, criterion_id)
  ) STRICT;
  INSERT INTO criterion_results (
    review_run_id, criterion_id, outcome, error_code, error_detail
  )
  SELECT review_run_id, criterion_id, outcome, NULL, NULL
  FROM criterion_results_v28;
  CREATE TABLE findings (
    id TEXT PRIMARY KEY,
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    review_run_id TEXT NOT NULL,
    criterion_id TEXT NOT NULL,
    evidence TEXT NOT NULL CHECK (length(trim(evidence)) > 0),
    remediation TEXT NOT NULL CHECK (length(trim(remediation)) > 0),
    location_kind TEXT NOT NULL
      CHECK (location_kind IN ('line_range', 'whole_side', 'changeset')),
    file_change_id TEXT,
    side TEXT CHECK (side IN ('base', 'head')),
    start_line INTEGER CHECK (start_line IS NULL OR start_line > 0),
    end_line INTEGER CHECK (end_line IS NULL OR end_line >= start_line),
    FOREIGN KEY (review_run_id, criterion_id)
      REFERENCES criterion_results(review_run_id, criterion_id),
    FOREIGN KEY (evaluation_id, file_change_id)
      REFERENCES evaluation_file_changes(evaluation_id, id),
    CHECK (
      (location_kind = 'changeset'
        AND file_change_id IS NULL AND side IS NULL
        AND start_line IS NULL AND end_line IS NULL)
      OR
      (location_kind = 'whole_side'
        AND file_change_id IS NOT NULL AND side IS NOT NULL
        AND start_line IS NULL AND end_line IS NULL)
      OR
      (location_kind = 'line_range'
        AND file_change_id IS NOT NULL AND side IS NOT NULL
        AND start_line IS NOT NULL AND end_line IS NOT NULL)
    )
  ) STRICT;
  INSERT INTO findings (
    id, evaluation_id, review_run_id, criterion_id,
    evidence, remediation, location_kind, file_change_id,
    side, start_line, end_line
  )
  SELECT
    id, evaluation_id, review_run_id, criterion_id,
    evidence, remediation, location_kind, file_change_id,
    side, start_line, end_line
  FROM findings_v28;
  DROP TABLE findings_v28;
  DROP TABLE criterion_results_v28;
`;
