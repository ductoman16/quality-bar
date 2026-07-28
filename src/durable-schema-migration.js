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
        ? `${FORGEJO_CONNECTION_SCHEMA}${FORGEJO_POLLING_MIGRATION}${WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA}${EVALUATION_SCHEMA}`
        : ""
    }
    UPDATE quality_bar_metadata
    SET value = '${schemaVersion}'
    WHERE key = 'schema_version';
    PRAGMA user_version = ${schemaVersion};
    COMMIT;
  `);
}
export const CURRENT_SCHEMA_VERSION = 22;
import { FORGEJO_CONNECTION_SCHEMA } from "./forgejo-connection-schema.js";
import { FORGEJO_POLLING_MIGRATION } from "./forgejo-polling-schema.js";
import { WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA } from "./waiver-adjudicator-configuration.js";
import { EVALUATION_SCHEMA } from "./evaluation-schema.js";
