import * as reviewAssignmentSchema from "./review-assignment-schema.js";
import * as reviewDeletionSchema from "./review-deletion-schema.js";

export const REVIEW_SCHEMA = `
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
    description TEXT NOT NULL CHECK (length(trim(description)) > 0),
    active_version_id TEXT NOT NULL REFERENCES review_versions(id) DEFERRABLE INITIALLY DEFERRED,
    archived_at INTEGER,
    hard_delete_pending INTEGER NOT NULL DEFAULT 0
      CHECK (hard_delete_pending IN (0, 1)),
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS review_versions (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id),
    number INTEGER NOT NULL CHECK (number > 0),
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    service_tier TEXT NOT NULL,
    applicability_rule TEXT,
    created_at INTEGER NOT NULL,
    sealed_at INTEGER,
    UNIQUE (review_id, number)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS criteria (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id),
    instruction TEXT NOT NULL CHECK (length(trim(instruction)) > 0),
    impact TEXT NOT NULL CHECK (impact IN ('advisory', 'blocking')),
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS review_version_criteria (
    review_version_id TEXT NOT NULL REFERENCES review_versions(id),
    criterion_id TEXT NOT NULL REFERENCES criteria(id),
    position INTEGER NOT NULL CHECK (position > 0),
    instruction TEXT NOT NULL CHECK (length(trim(instruction)) > 0),
    impact TEXT NOT NULL CHECK (impact IN ('advisory', 'blocking')),
    PRIMARY KEY (review_version_id, criterion_id),
    UNIQUE (review_version_id, position)
  ) STRICT;
  ${reviewAssignmentSchema.REVIEW_ASSIGNMENT_SCHEMA}
  CREATE TRIGGER IF NOT EXISTS review_versions_immutable_update
    BEFORE UPDATE ON review_versions
    WHEN OLD.sealed_at IS NOT NULL OR NEW.sealed_at IS NULL
    BEGIN SELECT RAISE(ABORT, 'review_version_immutable'); END;
  ${reviewDeletionSchema.REVIEW_DELETION_IMMUTABILITY}
  CREATE TRIGGER IF NOT EXISTS criteria_immutable_update
    BEFORE UPDATE ON criteria
    BEGIN SELECT RAISE(ABORT, 'criterion_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS review_version_criteria_immutable_update
    BEFORE UPDATE ON review_version_criteria
    BEGIN SELECT RAISE(ABORT, 'review_version_criterion_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS review_version_criteria_immutable_insert
    BEFORE INSERT ON review_version_criteria
    WHEN (SELECT sealed_at FROM review_versions WHERE id = NEW.review_version_id) IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'review_version_criterion_immutable'); END;
`;
