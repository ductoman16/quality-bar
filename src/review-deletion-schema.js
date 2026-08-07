export const REVIEW_DELETION_COLUMN_MIGRATION = `
  ALTER TABLE reviews
    ADD COLUMN hard_delete_pending INTEGER NOT NULL DEFAULT 0
    CHECK (hard_delete_pending IN (0, 1));
`;

export const REVIEW_DELETION_IMMUTABILITY = `
  DROP TRIGGER IF EXISTS review_hard_delete_marker_insert;
  CREATE TRIGGER review_hard_delete_marker_insert
    BEFORE INSERT ON reviews
    WHEN NEW.hard_delete_pending <> 0
    BEGIN SELECT RAISE(ABORT, 'review_hard_delete_marker_invalid'); END;
  DROP TRIGGER IF EXISTS review_versions_immutable_delete;
  CREATE TRIGGER review_versions_immutable_delete
    BEFORE DELETE ON review_versions
    WHEN NOT EXISTS (
      SELECT 1 FROM reviews
      WHERE id = OLD.review_id AND hard_delete_pending = 1
    )
    BEGIN SELECT RAISE(ABORT, 'review_version_immutable'); END;
  DROP TRIGGER IF EXISTS criteria_immutable_delete;
  CREATE TRIGGER criteria_immutable_delete
    BEFORE DELETE ON criteria
    WHEN NOT EXISTS (
      SELECT 1 FROM reviews
      WHERE id = OLD.review_id AND hard_delete_pending = 1
    )
    BEGIN SELECT RAISE(ABORT, 'criterion_immutable'); END;
  DROP TRIGGER IF EXISTS review_version_criteria_immutable_delete;
  CREATE TRIGGER review_version_criteria_immutable_delete
    BEFORE DELETE ON review_version_criteria
    WHEN NOT EXISTS (
      SELECT 1
      FROM review_versions
      JOIN reviews ON reviews.id = review_versions.review_id
      WHERE review_versions.id = OLD.review_version_id
        AND reviews.hard_delete_pending = 1
    )
    BEGIN SELECT RAISE(ABORT, 'review_version_criterion_immutable'); END;
`;

export const REVIEW_DELETION_LINEAGE_INTEGRITY = `
  DROP TRIGGER IF EXISTS review_hard_delete_lineage;
  CREATE TRIGGER review_hard_delete_lineage
    AFTER UPDATE OF hard_delete_pending ON reviews
    WHEN OLD.hard_delete_pending = 0 AND NEW.hard_delete_pending = 1
    BEGIN
      SELECT RAISE(ABORT, 'review_delete_unsupported')
      WHERE EXISTS (
        SELECT 1
        FROM review_runs
        JOIN review_versions
          ON review_versions.id = review_runs.review_version_id
        WHERE review_versions.review_id = NEW.id
      );
      DELETE FROM review_assignment_repositories WHERE review_id = NEW.id;
      DELETE FROM review_assignments WHERE review_id = NEW.id;
      DELETE FROM review_version_criteria
      WHERE review_version_id IN (
        SELECT id FROM review_versions WHERE review_id = NEW.id
      );
      DELETE FROM criteria WHERE review_id = NEW.id;
      DELETE FROM review_versions WHERE review_id = NEW.id;
      DELETE FROM reviews
      WHERE id = NEW.id AND hard_delete_pending = 1;
    END;
`;

export const REVIEW_DELETION_INTEGRITY = `
  ${REVIEW_DELETION_IMMUTABILITY}
  ${REVIEW_DELETION_LINEAGE_INTEGRITY}
`;
