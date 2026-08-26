import { fail } from "./durable-error.ts";
import {
  CURRENT_SCHEMA_DEFINITION,
  schemaDefinition,
} from "../offline/offline-restore-schema.ts";

export const EXPECTED_SCHEMA_TABLES = new Set(
  "applicability_results,applicability_selections,application_logs,authority_attributions,browser_sessions,codex_execution_pre_start_attempts,codex_execution_queue,codex_execution_settings,criteria,criterion_results,evaluation_file_changes,evaluation_idempotency,evaluation_pre_start_retries,evaluation_results,evaluations,findings,forgejo_automatic_evaluation_pull_requests,forgejo_automatic_evaluations,forgejo_commit_statuses,forgejo_connection_credentials,forgejo_connection_verifications,forgejo_connections,forgejo_delivery_attempts,forgejo_delivery_provider_gates,forgejo_feedback_bundles,forgejo_finding_feedback,forgejo_repositories,forgejo_repository_polls,forgejo_waiver_adjudication_followups,forgejo_waiver_decision_followups,github_automatic_evaluation_pull_requests,github_automatic_evaluations,github_commit_statuses,github_connection_credentials,github_connection_verifications,github_connections,github_delivery_attempts,github_delivery_provider_gates,github_feedback_bundles,github_finding_feedback,github_repositories,github_repository_polls,github_waiver_adjudication_followups,github_waiver_decision_followups,onboarding_tokens,quality_bar_metadata,repositories,repository_credentials,review_assignment_repositories,review_assignments,review_run_pre_start_attempts,review_run_transcript_chunks,review_runs,review_version_criteria,review_versions,reviews,waiver_adjudication_pre_start_attempts,waiver_adjudication_requests,waiver_adjudication_transcript_chunks,waiver_adjudications,waiver_adjudicator_configuration,waiver_batch_idempotency,waiver_decisions,waiver_recovery_idempotency,waiver_requests".split(
    ",",
  ),
);

/**
 * Validate the complete current schema before the database becomes authoritative.
 */
export function validateResultingSchema(
  database: import("node:sqlite").DatabaseSync,
) {
  const actualTables = new Set(
    database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((table) => table.name),
  );
  const missingTable = [...EXPECTED_SCHEMA_TABLES].find(
    (table) => !actualTables.has(table),
  );
  if (missingTable) {
    fail("schema_invalid", `SQLite schema table ${missingTable} is missing`);
  }
  if (
    JSON.stringify(schemaDefinition(database)) !== CURRENT_SCHEMA_DEFINITION
  ) {
    fail("schema_invalid", "SQLite schema does not match the current schema");
  }

  let foreignKeyViolation;
  try {
    foreignKeyViolation = database.prepare("PRAGMA foreign_key_check").get();
  } catch (error) {
    fail(
      "foreign_key_check_failed",
      "SQLite foreign-key integrity check could not complete",
      error,
    );
  }
  if (foreignKeyViolation) {
    fail(
      "foreign_key_check_failed",
      "SQLite foreign-key check found violation",
    );
  }
}
