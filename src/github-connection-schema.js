export const GITHUB_REPOSITORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS github_repositories (
    repository_id TEXT PRIMARY KEY REFERENCES repositories(id),
    connection_id TEXT NOT NULL REFERENCES github_connections(id),
    forge_repository_id INTEGER NOT NULL CHECK (forge_repository_id > 0),
    name TEXT NOT NULL CHECK (length(name) > 0),
    api_url TEXT NOT NULL CHECK (length(api_url) > 0),
    web_url TEXT NOT NULL CHECK (length(web_url) > 0),
    UNIQUE (connection_id, forge_repository_id)
  ) STRICT;
`;

const GITHUB_CONNECTION_HEALTH_INVARIANTS = `
  CREATE TRIGGER IF NOT EXISTS github_connection_health_valid_insert
    BEFORE INSERT ON github_connections
    WHEN NOT (
      (NEW.health = 'healthy'
        AND NEW.health_error_code IS NULL
        AND NEW.health_error_message IS NULL)
      OR
      (NEW.health = 'error'
        AND NEW.health_error_code IS NOT NULL
        AND NEW.health_error_message IS NOT NULL
        AND length(NEW.health_error_code) > 0
        AND length(NEW.health_error_message) > 0)
    )
    BEGIN SELECT RAISE(ABORT, 'github_connection_health_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS github_connection_health_valid_update
    BEFORE UPDATE ON github_connections
    WHEN NOT (
      (NEW.health = 'healthy'
        AND NEW.health_error_code IS NULL
        AND NEW.health_error_message IS NULL)
      OR
      (NEW.health = 'error'
        AND NEW.health_error_code IS NOT NULL
        AND NEW.health_error_message IS NOT NULL
        AND length(NEW.health_error_code) > 0
        AND length(NEW.health_error_message) > 0)
    )
    BEGIN SELECT RAISE(ABORT, 'github_connection_health_invalid'); END;
`;

const GITHUB_CONNECTION_VERIFICATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS github_connection_verifications (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES github_connections(id),
    trigger TEXT NOT NULL CHECK (
      trigger IN ('onboarding', 'repository_selection', 'enablement')
    ),
    outcome TEXT NOT NULL DEFAULT 'success'
      CHECK (outcome IN ('success', 'error')),
    error_code TEXT,
    error_message TEXT,
    error_repository_id INTEGER CHECK (
      error_repository_id IS NULL OR error_repository_id > 0
    ),
    api_profile TEXT,
    principal_id INTEGER CHECK (principal_id IS NULL OR principal_id > 0),
    principal_login TEXT,
    permissions TEXT CHECK (permissions IS NULL OR json_valid(permissions)),
    capabilities TEXT CHECK (
      capabilities IS NULL OR json_valid(capabilities)
    ),
    affected_repository_ids TEXT NOT NULL CHECK (
      json_valid(affected_repository_ids)
      AND json_array_length(affected_repository_ids) > 0
    ),
    repository_checks TEXT NOT NULL CHECK (
      json_valid(repository_checks)
      AND json_array_length(repository_checks) > 0
    ),
    repositories TEXT NOT NULL CHECK (json_valid(repositories)),
    verified_at INTEGER NOT NULL,
    CHECK (
      (outcome = 'success'
        AND error_code IS NULL
        AND error_message IS NULL
        AND error_repository_id IS NULL
        AND api_profile IS NOT NULL
        AND principal_id IS NOT NULL
        AND principal_login IS NOT NULL
        AND permissions IS NOT NULL
        AND capabilities IS NOT NULL
        AND json_array_length(repositories) > 0)
      OR
      (outcome = 'error'
        AND error_code IS NOT NULL
        AND error_message IS NOT NULL
        AND length(error_code) > 0
        AND length(error_message) > 0)
    )
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS github_connection_verification_checks_valid
    BEFORE INSERT ON github_connection_verifications
    WHEN
      json_array_length(NEW.repository_checks)
        != json_array_length(NEW.affected_repository_ids)
      OR EXISTS (
        SELECT 1 FROM json_each(NEW.repository_checks)
        WHERE json_type(value, '$.repository_id') != 'integer'
          OR json_extract(value, '$.repository_id') <= 0
          OR json_extract(value, '$.repository_id') NOT IN (
            SELECT value FROM json_each(NEW.affected_repository_ids)
          )
          OR json_extract(value, '$.outcome')
            NOT IN ('success', 'error', 'not_completed')
      )
      OR (
        SELECT count(DISTINCT json_extract(value, '$.repository_id'))
        FROM json_each(NEW.repository_checks)
      ) != json_array_length(NEW.repository_checks)
      OR (
        NEW.outcome = 'success'
        AND EXISTS (
          SELECT 1 FROM json_each(NEW.repository_checks)
          WHERE json_extract(value, '$.outcome') != 'success'
        )
      )
      OR (
        NEW.outcome = 'error'
        AND (
          (
            NEW.error_repository_id IS NULL
            AND EXISTS (
              SELECT 1 FROM json_each(NEW.repository_checks)
              WHERE json_extract(value, '$.outcome') = 'error'
            )
          )
          OR (
            NEW.error_repository_id IS NOT NULL
            AND (
              SELECT count(*) FROM json_each(NEW.repository_checks)
              WHERE json_extract(value, '$.repository_id')
                = NEW.error_repository_id
                AND json_extract(value, '$.outcome') = 'error'
            ) != 1
            OR EXISTS (
              SELECT 1 FROM json_each(NEW.repository_checks)
              WHERE json_extract(value, '$.outcome') = 'error'
                AND json_extract(value, '$.repository_id')
                  != NEW.error_repository_id
            )
          )
        )
      )
    BEGIN SELECT RAISE(
      ABORT, 'github_connection_verification_checks_invalid'
    ); END;
  CREATE TRIGGER IF NOT EXISTS github_connection_verification_immutable_update
    BEFORE UPDATE ON github_connection_verifications
    BEGIN SELECT RAISE(ABORT, 'github_connection_verification_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS github_connection_verification_immutable_delete
    BEFORE DELETE ON github_connection_verifications
    BEGIN SELECT RAISE(ABORT, 'github_connection_verification_immutable'); END;
`;

export const GITHUB_CONNECTION_HEALTH_MIGRATION = `
  ALTER TABLE github_connections
    ADD COLUMN health TEXT NOT NULL DEFAULT 'healthy'
      CHECK (health IN ('healthy', 'error'));
  ALTER TABLE github_connections ADD COLUMN health_error_code TEXT;
  ALTER TABLE github_connections ADD COLUMN health_error_message TEXT;
  ${GITHUB_CONNECTION_HEALTH_INVARIANTS}
  DROP TRIGGER github_connection_verification_immutable_update;
  DROP TRIGGER github_connection_verification_immutable_delete;
  ALTER TABLE github_connection_verifications
    RENAME TO github_connection_verifications_v13;
  ${GITHUB_CONNECTION_VERIFICATION_SCHEMA}
  INSERT INTO github_connection_verifications (
    id, connection_id, trigger, outcome, error_code, error_message,
    error_repository_id, api_profile, principal_id, principal_login,
    permissions, capabilities, affected_repository_ids, repository_checks,
    repositories, verified_at
  )
  SELECT
    id, connection_id, trigger, 'success', NULL, NULL, NULL,
    api_profile, principal_id, principal_login, permissions, capabilities,
    (
      SELECT json_group_array(json_extract(value, '$.id'))
      FROM json_each(github_connection_verifications_v13.repositories)
    ),
    (
      SELECT json_group_array(json_object(
        'repository_id', json_extract(value, '$.id'),
        'outcome', 'success'
      ))
      FROM json_each(github_connection_verifications_v13.repositories)
    ),
    repositories, verified_at
  FROM github_connection_verifications_v13
  ORDER BY rowid;
  DROP TABLE github_connection_verifications_v13;
`;

export const GITHUB_CONNECTION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS github_connections (
    singleton_key INTEGER PRIMARY KEY DEFAULT 1 CHECK (singleton_key = 1),
    id TEXT NOT NULL UNIQUE,
    app_id INTEGER NOT NULL UNIQUE CHECK (app_id > 0),
    app_slug TEXT NOT NULL CHECK (length(app_slug) > 0),
    installation_id INTEGER NOT NULL UNIQUE CHECK (installation_id > 0),
    principal_id INTEGER NOT NULL CHECK (principal_id > 0),
    principal_login TEXT NOT NULL CHECK (length(principal_login) > 0),
    api_profile TEXT NOT NULL,
    permissions TEXT NOT NULL CHECK (json_valid(permissions)),
    capabilities TEXT NOT NULL CHECK (json_valid(capabilities)),
    repository_count INTEGER NOT NULL CHECK (repository_count > 0),
    health TEXT NOT NULL DEFAULT 'healthy'
      CHECK (health IN ('healthy', 'error')),
    health_error_code TEXT,
    health_error_message TEXT,
    created_at INTEGER NOT NULL,
    verified_at INTEGER NOT NULL
  ) STRICT;
  ${GITHUB_CONNECTION_HEALTH_INVARIANTS}
  CREATE TABLE IF NOT EXISTS github_connection_credentials (
    connection_id TEXT PRIMARY KEY REFERENCES github_connections(id),
    encrypted_credential TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  ${GITHUB_CONNECTION_VERIFICATION_SCHEMA}
  ${GITHUB_REPOSITORY_SCHEMA}
`;
