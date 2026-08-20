import { fail } from "./durable-error.js";
import { GITHUB_CONNECTION_SCHEMA } from "./github-connection-schema.js";
import { GITHUB_POLLING_SCHEMA } from "./github-polling-schema.js";
import { REPOSITORY_CREDENTIAL_SCHEMA } from "./repository-credential-schema.js";
import * as repositorySchema from "./repository-schema.js";
import { FORGEJO_CONNECTION_SCHEMA } from "./forgejo-connection-schema.js";
import { FORGEJO_POLLING_SCHEMA } from "./forgejo-polling-schema.js";
import { WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA } from "./waiver-adjudicator-configuration.js";
import { EVALUATION_SCHEMA } from "./evaluation-schema.js";
import { GITHUB_FEEDBACK_SCHEMA } from "./github-feedback-schema.js";
import { FORGEJO_FEEDBACK_SCHEMA } from "./forgejo-feedback-schema.js";
import { FORGEJO_DELIVERY_SCHEMA } from "./forgejo-delivery-schema.js";
import * as reviewDeletionSchema from "./review-deletion-schema.js";
import { WAIVER_BATCH_SCHEMA } from "./waiver-batch-schema.js";
import { WAIVER_FOLLOWUP_SCHEMA } from "./waiver-followup-schema.js";
import { REVIEW_SCHEMA } from "./review-schema.js";
import { ONBOARDING_TOKEN_SCHEMA } from "./onboarding-token-schema.js";
import { RETENTION_SCHEMA } from "./retention-schema.js";
import { WAIVER_ADJUDICATION_RECOVERY_BASELINE } from "./waiver-adjudication-recovery-schema.js";

export const SCHEMA_VERSION = 53;

const AUTHORITY_ATTRIBUTION_SCHEMA = `
  CREATE TABLE authority_attributions (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL CHECK (channel IN ('browser_session', 'host', 'implementer_token', 'onboarding_token')),
    action TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'forbidden')),
    error_code TEXT,
    occurred_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX authority_attributions_keyset
    ON authority_attributions (occurred_at DESC, id DESC);
`;

/** @param {import("node:sqlite").DatabaseSync} database */
export function initializeOrValidateSchema(database) {
  const version = database.prepare("PRAGMA user_version").get()?.user_version;
  if (version !== 0 && version !== SCHEMA_VERSION) {
    fail(
      "schema_invalid",
      `SQLite schema version ${String(version)} is not supported`,
    );
  }
  if (version === SCHEMA_VERSION) {
    return;
  }
  const existingObject = database
    .prepare(
      "SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1",
    )
    .get();
  if (existingObject) {
    fail(
      "schema_invalid",
      "SQLite schema version 0 contains unsupported objects",
    );
  }
  database.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE quality_bar_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE browser_sessions (
      session_hash TEXT PRIMARY KEY,
      csrf_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_authenticated_at INTEGER NOT NULL
    ) STRICT;
    ${AUTHORITY_ATTRIBUTION_SCHEMA}
    ${ONBOARDING_TOKEN_SCHEMA}
    ${REVIEW_SCHEMA}
    ${repositorySchema.REPOSITORY_SCHEMA}
    ${REPOSITORY_CREDENTIAL_SCHEMA}
    ${GITHUB_CONNECTION_SCHEMA}
    ${GITHUB_POLLING_SCHEMA}
    ${FORGEJO_CONNECTION_SCHEMA}
    ${FORGEJO_POLLING_SCHEMA}
    ${WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA}
    ${RETENTION_SCHEMA}
    ${EVALUATION_SCHEMA}
    ${WAIVER_BATCH_SCHEMA}${WAIVER_ADJUDICATION_RECOVERY_BASELINE}
    ${GITHUB_FEEDBACK_SCHEMA}
    ${FORGEJO_FEEDBACK_SCHEMA}
    ${FORGEJO_DELIVERY_SCHEMA}
    ${WAIVER_FOLLOWUP_SCHEMA}
    ${reviewDeletionSchema.REVIEW_DELETION_LINEAGE_INTEGRITY}
    ${repositorySchema.REPOSITORY_USAGE_INTEGRITY}
    INSERT INTO quality_bar_metadata (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}');
    PRAGMA user_version = ${SCHEMA_VERSION};
    COMMIT;
  `);
}
