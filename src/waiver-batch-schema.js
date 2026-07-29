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
    CHECK (length(base_commit) = length(head_commit)),
    CHECK (requests_sealed_at IS NULL OR requests_sealed_at >= created_at)
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS waiver_adjudication_active_evaluation
    ON waiver_adjudications (evaluation_id)
    WHERE execution_status IN ('queued', 'running');
  CREATE TABLE IF NOT EXISTS waiver_requests (
    id TEXT PRIMARY KEY,
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    finding_id TEXT NOT NULL REFERENCES findings(id),
    rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
    requester_channel TEXT NOT NULL
      CHECK (requester_channel IN ('browser_session', 'implementer_token')),
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS waiver_adjudication_requests (
    waiver_adjudication_id TEXT NOT NULL REFERENCES waiver_adjudications(id),
    waiver_request_id TEXT NOT NULL REFERENCES waiver_requests(id),
    position INTEGER NOT NULL CHECK (position > 0),
    PRIMARY KEY (waiver_adjudication_id, waiver_request_id),
    UNIQUE (waiver_adjudication_id, position)
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
  CREATE TRIGGER IF NOT EXISTS waiver_request_immutable_delete
    BEFORE DELETE ON waiver_requests
    BEGIN SELECT RAISE(ABORT, 'waiver_request_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_identity_immutable
    BEFORE UPDATE OF evaluation_id, base_commit, head_commit, model,
      reasoning_effort, service_tier, created_at
    ON waiver_adjudications
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_immutable'); END;
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
    worker_id, fencing_token, lease_expires_at
  )
  SELECT work_id, work_kind, ready_at, accepted_at, started_at,
         worker_id, fencing_token, lease_expires_at
  FROM codex_execution_queue_v34;
  DROP TABLE codex_execution_queue_v34;
`;
