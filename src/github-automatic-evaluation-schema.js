export const GITHUB_AUTOMATIC_EVALUATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS github_automatic_evaluations (
    evaluation_id TEXT PRIMARY KEY REFERENCES evaluations(id),
    repository_id TEXT NOT NULL REFERENCES repositories(id),
    pull_request_number INTEGER NOT NULL CHECK (pull_request_number > 0),
    base_commit TEXT NOT NULL CHECK (
      length(base_commit) IN (40, 64)
      AND base_commit NOT GLOB '*[^0-9a-f]*'
    ),
    head_commit TEXT NOT NULL CHECK (
      length(head_commit) IN (40, 64)
      AND head_commit NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (length(base_commit) = length(head_commit)),
    UNIQUE (repository_id, base_commit, head_commit)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS github_automatic_evaluation_immutable_update
    BEFORE UPDATE ON github_automatic_evaluations
    BEGIN SELECT RAISE(ABORT, 'github_automatic_evaluation_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS github_automatic_evaluation_immutable_delete
    BEFORE DELETE ON github_automatic_evaluations
    BEGIN SELECT RAISE(ABORT, 'github_automatic_evaluation_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS github_automatic_evaluation_matches_evaluation
    BEFORE INSERT ON github_automatic_evaluations
    WHEN NOT EXISTS (
      SELECT 1 FROM evaluations
      WHERE id = NEW.evaluation_id
        AND repository_id = NEW.repository_id
        AND base_commit = NEW.base_commit
        AND head_commit = NEW.head_commit
    )
    BEGIN SELECT RAISE(ABORT, 'github_automatic_evaluation_mismatch'); END;
`;
