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
    next_attempt_at INTEGER,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    CHECK (length(base_commit) = length(head_commit)),
    CHECK (next_attempt_at IS NULL OR execution_status = 'queued')
  ) STRICT;
  CREATE INDEX IF NOT EXISTS evaluations_newest
    ON evaluations (created_at DESC, id DESC);
  CREATE TABLE IF NOT EXISTS evaluation_results (
    evaluation_id TEXT PRIMARY KEY REFERENCES evaluations(id),
    outcome TEXT NOT NULL
      CHECK (outcome IN ('clear', 'advisory', 'blocking', 'error')),
    completed_at INTEGER NOT NULL
  ) STRICT;
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
    created_at INTEGER NOT NULL,
    CHECK (started_at IS NULL OR started_at >= created_at),
    CHECK (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at)),
    UNIQUE (evaluation_id, review_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS criterion_results (
    review_run_id TEXT NOT NULL REFERENCES review_runs(id),
    criterion_id TEXT NOT NULL REFERENCES criteria(id),
    outcome TEXT NOT NULL CHECK (outcome = 'clear'),
    PRIMARY KEY (review_run_id, criterion_id)
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
  CREATE TRIGGER IF NOT EXISTS criterion_result_immutable_update
    BEFORE UPDATE ON criterion_results
    BEGIN SELECT RAISE(ABORT, 'criterion_result_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS criterion_result_immutable_delete
    BEFORE DELETE ON criterion_results
    BEGIN SELECT RAISE(ABORT, 'criterion_result_immutable'); END;
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
