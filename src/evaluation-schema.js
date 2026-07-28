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
`;
