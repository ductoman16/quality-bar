const REVIEW_ASSIGNMENT_INTEGRITY = `
  CREATE TRIGGER IF NOT EXISTS review_assignment_repository_scope_insert
    BEFORE INSERT ON review_assignment_repositories
    WHEN (
      SELECT scope FROM review_assignments
      WHERE review_id = NEW.review_id
    ) <> 'repository_set'
    BEGIN SELECT RAISE(ABORT, 'review_assignment_scope_conflict'); END;
  CREATE TRIGGER IF NOT EXISTS review_assignment_repository_scope_update
    BEFORE UPDATE OF review_id ON review_assignment_repositories
    WHEN (
      SELECT scope FROM review_assignments
      WHERE review_id = NEW.review_id
    ) <> 'repository_set'
    BEGIN SELECT RAISE(ABORT, 'review_assignment_scope_conflict'); END;
  CREATE TRIGGER IF NOT EXISTS review_assignment_scope_update
    BEFORE UPDATE OF scope ON review_assignments
    WHEN NEW.scope = 'installation_wide' AND EXISTS (
      SELECT 1 FROM review_assignment_repositories
      WHERE review_id = NEW.review_id
    )
    BEGIN SELECT RAISE(ABORT, 'review_assignment_scope_conflict'); END;
`;

export const REVIEW_ASSIGNMENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS review_assignments (
    review_id TEXT PRIMARY KEY REFERENCES reviews(id),
    scope TEXT NOT NULL
      CHECK (scope IN ('installation_wide', 'repository_set')),
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS review_assignment_repositories (
    review_id TEXT NOT NULL REFERENCES review_assignments(review_id)
      ON DELETE CASCADE,
    repository_id TEXT NOT NULL REFERENCES repositories(id),
    PRIMARY KEY (review_id, repository_id)
  ) STRICT;
  ${REVIEW_ASSIGNMENT_INTEGRITY}
`;
