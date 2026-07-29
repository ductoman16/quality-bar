/**
 * @param {import("node:sqlite").DatabaseSync} database
 * @param {string} statements
 * @param {number} schemaVersion
 */
export function migrateSchema(
  database,
  statements,
  schemaVersion = CURRENT_SCHEMA_VERSION,
) {
  database.exec(`
    BEGIN IMMEDIATE;
    ${statements}
    ${
      schemaVersion === CURRENT_SCHEMA_VERSION
        ? `${HOST_ATTRIBUTION_MIGRATION}${FORGEJO_CONNECTION_SCHEMA}${FORGEJO_POLLING_MIGRATION}${WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA}${EVALUATION_SCHEMA}`
        : ""
    }
    UPDATE quality_bar_metadata
    SET value = '${schemaVersion}'
    WHERE key = 'schema_version';
    PRAGMA user_version = ${schemaVersion};
    COMMIT;
  `);
}
export const CURRENT_SCHEMA_VERSION = 25;
import { FORGEJO_CONNECTION_SCHEMA } from "./forgejo-connection-schema.js";
import { FORGEJO_POLLING_MIGRATION } from "./forgejo-polling-schema.js";
import { WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA } from "./waiver-adjudicator-configuration.js";
import { EVALUATION_SCHEMA } from "./evaluation-schema.js";

export const AUTHORITY_ATTRIBUTION_SCHEMA = `
  CREATE TABLE authority_attributions (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL CHECK (channel IN ('browser_session', 'host', 'implementer_token')),
    action TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'forbidden')),
    error_code TEXT,
    occurred_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX authority_attributions_keyset
    ON authority_attributions (occurred_at DESC, id DESC);
`;

export const HOST_ATTRIBUTION_MIGRATION = `
  DROP INDEX authority_attributions_keyset;
  ALTER TABLE authority_attributions
    RENAME TO authority_attributions_v21;
  CREATE TABLE authority_attributions (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL CHECK (channel IN ('browser_session', 'host', 'implementer_token')),
    action TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'forbidden')),
    error_code TEXT,
    occurred_at INTEGER NOT NULL
  ) STRICT;
  INSERT INTO authority_attributions (
    id,
    channel,
    action,
    outcome,
    error_code,
    occurred_at
  )
  SELECT
    id,
    channel,
    action,
    outcome,
    error_code,
    occurred_at
  FROM authority_attributions_v21;
  DROP TABLE authority_attributions_v21;
  CREATE INDEX authority_attributions_keyset
    ON authority_attributions (occurred_at DESC, id DESC);
`;
