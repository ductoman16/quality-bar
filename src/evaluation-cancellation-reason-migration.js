import {
  EVALUATION_CANCELLATION_CHECK,
  EVALUATION_CANCELLATION_COLUMNS,
} from "./evaluation-cancellation-schema.js";

export const EVALUATION_CANCELLATION_REASON_MIGRATION = `
  PRAGMA defer_foreign_keys = ON;
  DROP TRIGGER github_automatic_evaluation_matches_evaluation;
  DROP TRIGGER applicability_selection_closed_insert;
  DROP TRIGGER applicability_result_closed_insert;
  CREATE TABLE evaluations_v36 (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repositories(id),
    provenance TEXT NOT NULL CHECK (provenance = 'explicit'),
    base_selector_type TEXT NOT NULL
      CHECK (base_selector_type IN ('branch', 'commit')),
    base_selector_value TEXT NOT NULL,
    head_selector_type TEXT NOT NULL
      CHECK (head_selector_type IN ('branch', 'commit')),
    head_selector_value TEXT NOT NULL,
    base_commit TEXT NOT NULL CHECK (
      length(base_commit) IN (40, 64)
      AND base_commit NOT GLOB '*[^0-9a-f]*'
    ),
    head_commit TEXT NOT NULL CHECK (
      length(head_commit) IN (40, 64)
      AND head_commit NOT GLOB '*[^0-9a-f]*'
    ),
    execution_status TEXT NOT NULL CHECK (
      execution_status IN (
        'queued',
        'running',
        'completed',
        'failed',
        'cancelled'
      )
    ),
    applicability_sealed_at INTEGER,
    ${EVALUATION_CANCELLATION_COLUMNS}
    next_attempt_at INTEGER,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    CHECK (length(base_commit) = length(head_commit)),
    CHECK (next_attempt_at IS NULL OR execution_status = 'queued'),
    CHECK (
      applicability_sealed_at IS NULL
      OR applicability_sealed_at >= created_at
    ),
    ${EVALUATION_CANCELLATION_CHECK}
  ) STRICT;
  INSERT INTO evaluations_v36 (
    id,
    repository_id,
    provenance,
    base_selector_type,
    base_selector_value,
    head_selector_type,
    head_selector_value,
    base_commit,
    head_commit,
    execution_status,
    applicability_sealed_at,
    cancellation_requested_at,
    cancellation_code,
    cancellation_detail,
    next_attempt_at,
    created_at,
    completed_at
  )
  SELECT
    id,
    repository_id,
    provenance,
    base_selector_type,
    base_selector_value,
    head_selector_type,
    head_selector_value,
    base_commit,
    head_commit,
    execution_status,
    applicability_sealed_at,
    cancellation_requested_at,
    cancellation_code,
    cancellation_detail,
    next_attempt_at,
    created_at,
    completed_at
  FROM evaluations;
  DROP TABLE evaluations;
  ALTER TABLE evaluations_v36 RENAME TO evaluations;
`;

/**
 * @param {import("node:sqlite").DatabaseSync} database
 * @param {(database: import("node:sqlite").DatabaseSync, statements: string) => void} migrateSchema
 */
export function migrateEvaluationCancellationReason(database, migrateSchema) {
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    migrateSchema(database, EVALUATION_CANCELLATION_REASON_MIGRATION);
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}
