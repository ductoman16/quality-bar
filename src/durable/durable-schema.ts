import { GITHUB_CONNECTION_SCHEMA } from "../github/github-connection-schema.ts";
import { GITHUB_POLLING_SCHEMA } from "../github/github-polling-schema.ts";
import { REPOSITORY_CREDENTIAL_SCHEMA } from "../repository/repository-credential-schema.ts";
import * as repositorySchema from "../repository/repository-schema.ts";
import { FORGEJO_CONNECTION_SCHEMA } from "../forgejo/forgejo-connection-schema.ts";
import { FORGEJO_POLLING_SCHEMA } from "../forgejo/forgejo-polling-schema.ts";
import { WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA } from "../waiver/waiver-adjudicator-configuration.ts";
import { EVALUATION_SCHEMA } from "../evaluation/evaluation-schema.ts";
import { GITHUB_FEEDBACK_SCHEMA } from "../github/github-feedback-schema.ts";
import { FORGEJO_FEEDBACK_SCHEMA } from "../forgejo/forgejo-feedback-schema.ts";
import { FORGEJO_DELIVERY_SCHEMA } from "../forgejo/forgejo-delivery-schema.ts";
import * as reviewDeletionSchema from "../review/review-deletion-schema.ts";
import { WAIVER_BATCH_SCHEMA } from "../waiver/waiver-batch-schema.ts";
import { WAIVER_FOLLOWUP_SCHEMA } from "../waiver/waiver-followup-schema.ts";
import { REVIEW_SCHEMA } from "../review/review-schema.ts";
import { ONBOARDING_TOKEN_SCHEMA } from "../onboarding-token-schema.ts";
import { RETENTION_SCHEMA } from "../retention-schema.ts";
import { WAIVER_ADJUDICATION_RECOVERY_BASELINE } from "../waiver/waiver-adjudication-recovery-schema.ts";

const AUTHORITY_ATTRIBUTION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS authority_attributions (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL CHECK (channel IN ('browser_session', 'host', 'implementer_token', 'onboarding_token')),
    action TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'forbidden')),
    error_code TEXT,
    occurred_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS authority_attributions_keyset
    ON authority_attributions (occurred_at DESC, id DESC);
`;

export function initializeOrValidateSchema(
  database: import("node:sqlite").DatabaseSync,
) {
  database.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS quality_bar_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS browser_sessions (
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
    COMMIT;
  `);
}
