export const GITHUB_POLLING_SCHEMA = `
  CREATE TABLE IF NOT EXISTS github_repository_polls (
    connection_id TEXT NOT NULL REFERENCES github_connections(id),
    forge_repository_id INTEGER NOT NULL CHECK (forge_repository_id > 0),
    baseline_status TEXT NOT NULL
      CHECK (baseline_status IN ('pending', 'complete', 'error')),
    last_success_at INTEGER,
    error_code TEXT,
    error_message TEXT,
    rate_gate_until INTEGER,
    next_attempt_at INTEGER,
    snapshot TEXT,
    PRIMARY KEY (connection_id, forge_repository_id),
    CHECK (
      (error_code IS NULL AND error_message IS NULL)
      OR (error_code IS NOT NULL AND error_message IS NOT NULL)
    ),
    CHECK (
      (baseline_status = 'complete'
        AND last_success_at IS NOT NULL
        AND snapshot IS NOT NULL)
      OR (baseline_status = 'pending'
        AND last_success_at IS NULL
        AND error_code IS NULL
        AND next_attempt_at IS NOT NULL
        AND snapshot IS NULL)
      OR (baseline_status = 'error' AND error_code IS NOT NULL)
    )
  ) STRICT;
  CREATE INDEX IF NOT EXISTS github_repository_polls_due
    ON github_repository_polls (next_attempt_at);
`;
