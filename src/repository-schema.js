export const REPOSITORY_HEALTH_INTEGRITY = `
  CREATE TRIGGER IF NOT EXISTS repository_health_integrity_insert
    BEFORE INSERT ON repositories
    WHEN NOT (
      (NEW.health = 'healthy'
        AND NEW.health_error_code IS NULL
        AND NEW.health_error_message IS NULL)
      OR
      (NEW.health = 'error'
        AND NEW.health_error_code IS NOT NULL
        AND NEW.health_error_message IS NOT NULL)
    )
    BEGIN SELECT RAISE(ABORT, 'repository_health_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS repository_health_integrity_update
    BEFORE UPDATE OF health, health_error_code, health_error_message
    ON repositories
    WHEN NOT (
      (NEW.health = 'healthy'
        AND NEW.health_error_code IS NULL
        AND NEW.health_error_message IS NULL)
      OR
      (NEW.health = 'error'
        AND NEW.health_error_code IS NOT NULL
        AND NEW.health_error_message IS NOT NULL)
    )
    BEGIN SELECT RAISE(ABORT, 'repository_health_invalid'); END;
`;

export const REPOSITORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS repositories (
    id TEXT PRIMARY KEY,
    normalized_url TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    verified_at INTEGER NOT NULL,
    lifecycle TEXT NOT NULL DEFAULT 'enabled'
      CHECK (lifecycle IN ('enabled', 'disabled', 'retired')),
    lifecycle_revision INTEGER NOT NULL DEFAULT 0
      CHECK (lifecycle_revision >= 0),
    health TEXT NOT NULL DEFAULT 'healthy'
      CHECK (health IN ('healthy', 'error')),
    health_error_code TEXT,
    health_error_message TEXT,
    has_been_used INTEGER NOT NULL DEFAULT 0
      CHECK (has_been_used IN (0, 1)),
    CHECK (
      (health = 'healthy' AND health_error_code IS NULL AND health_error_message IS NULL)
      OR
      (health = 'error' AND health_error_code IS NOT NULL AND health_error_message IS NOT NULL)
    )
  ) STRICT;
  ${REPOSITORY_HEALTH_INTEGRITY}
`;

export const REPOSITORY_USAGE_MIGRATION = `
  ALTER TABLE repositories ADD COLUMN has_been_used INTEGER NOT NULL DEFAULT 0
    CHECK (has_been_used IN (0, 1));
  ALTER TABLE repositories ADD COLUMN lifecycle_revision INTEGER NOT NULL DEFAULT 0
    CHECK (lifecycle_revision >= 0);
  UPDATE repositories SET has_been_used = 1;
`;

export const REPOSITORY_USAGE_INTEGRITY = `
  CREATE TRIGGER IF NOT EXISTS repository_usage_immutable
    BEFORE UPDATE OF has_been_used ON repositories
    WHEN OLD.has_been_used = 1 AND NEW.has_been_used != 1
    BEGIN SELECT RAISE(ABORT, 'repository_usage_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS repository_used_by_assignment
    AFTER INSERT ON review_assignment_repositories
    BEGIN
      UPDATE repositories SET has_been_used = 1
      WHERE id = NEW.repository_id;
    END;
  CREATE TRIGGER IF NOT EXISTS repository_used_by_evaluation
    AFTER INSERT ON evaluations
    BEGIN
      UPDATE repositories SET has_been_used = 1
      WHERE id = NEW.repository_id;
    END;
`;

export const REPOSITORY_LIFECYCLE_MIGRATION = `
  ALTER TABLE repositories ADD COLUMN lifecycle TEXT NOT NULL
    DEFAULT 'enabled'
    CHECK (lifecycle IN ('enabled', 'disabled', 'retired'));
  ALTER TABLE repositories ADD COLUMN health TEXT NOT NULL
    DEFAULT 'healthy'
    CHECK (health IN ('healthy', 'error'));
  ALTER TABLE repositories ADD COLUMN health_error_code TEXT;
  ALTER TABLE repositories ADD COLUMN health_error_message TEXT;
  ${REPOSITORY_HEALTH_INTEGRITY}
`;
