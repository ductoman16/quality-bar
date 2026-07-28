export const FORGEJO_CONNECTION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS forgejo_connections (
    id TEXT PRIMARY KEY,
    singleton INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1) UNIQUE,
    base_url TEXT NOT NULL UNIQUE,
    api_profile TEXT NOT NULL CHECK (api_profile = 'forgejo-v16'),
    reported_version TEXT NOT NULL,
    principal_id INTEGER NOT NULL CHECK (principal_id > 0),
    principal_login TEXT NOT NULL CHECK (length(principal_login) > 0),
    scopes TEXT NOT NULL CHECK (json_valid(scopes)),
    capabilities TEXT NOT NULL CHECK (json_valid(capabilities)),
    health TEXT NOT NULL CHECK (health IN ('healthy', 'error')),
    created_at INTEGER NOT NULL,
    verified_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS forgejo_connection_credentials (
    connection_id TEXT PRIMARY KEY REFERENCES forgejo_connections(id),
    encrypted_credential TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS forgejo_connection_verifications (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES forgejo_connections(id),
    trigger TEXT NOT NULL CHECK (
      trigger IN ('onboarding', 'enablement', 'rotation', 'manual_test', 'capability_drift')
    ),
    profile TEXT CHECK (profile IS NULL OR profile = 'forgejo-v16'),
    reported_version TEXT,
    principal TEXT CHECK (principal IS NULL OR json_valid(principal)),
    scopes TEXT CHECK (scopes IS NULL OR json_valid(scopes)),
    capabilities TEXT CHECK (capabilities IS NULL OR json_valid(capabilities)),
    repositories TEXT CHECK (repositories IS NULL OR json_valid(repositories)),
    error_code TEXT,
    error_message TEXT,
    verified_at INTEGER NOT NULL,
    CHECK (
      (
        error_code IS NULL
        AND error_message IS NULL
        AND profile IS NOT NULL
        AND reported_version IS NOT NULL
        AND principal IS NOT NULL
        AND scopes IS NOT NULL
        AND capabilities IS NOT NULL
        AND repositories IS NOT NULL
      )
      OR
      (error_code IS NOT NULL AND error_message IS NOT NULL)
    )
  ) STRICT;
  CREATE TABLE IF NOT EXISTS forgejo_repositories (
    repository_id TEXT PRIMARY KEY REFERENCES repositories(id),
    connection_id TEXT NOT NULL REFERENCES forgejo_connections(id),
    verification_id TEXT NOT NULL REFERENCES forgejo_connection_verifications(id),
    forge_repository_id INTEGER NOT NULL CHECK (forge_repository_id > 0),
    name TEXT NOT NULL CHECK (length(name) > 0),
    api_url TEXT NOT NULL CHECK (length(api_url) > 0),
    web_url TEXT NOT NULL CHECK (length(web_url) > 0),
    UNIQUE (connection_id, forge_repository_id)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS forgejo_connection_verifications_immutable_update
    BEFORE UPDATE ON forgejo_connection_verifications
    BEGIN SELECT RAISE(ABORT, 'forgejo_connection_verification_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS forgejo_connection_verifications_immutable_delete
    BEFORE DELETE ON forgejo_connection_verifications
    BEGIN SELECT RAISE(ABORT, 'forgejo_connection_verification_immutable'); END;
`;

export const FORGEJO_VERIFICATION_HISTORY_MIGRATION = `
  DROP TRIGGER IF EXISTS forgejo_connection_verifications_immutable_update;
  DROP TRIGGER IF EXISTS forgejo_connection_verifications_immutable_delete;
  ALTER TABLE forgejo_repositories RENAME TO forgejo_repositories_v17;
  ALTER TABLE forgejo_connection_verifications
    RENAME TO forgejo_connection_verifications_v17;
  ${FORGEJO_CONNECTION_SCHEMA}
  INSERT INTO forgejo_connection_verifications (
    id,
    connection_id,
    trigger,
    profile,
    reported_version,
    principal,
    scopes,
    capabilities,
    repositories,
    error_code,
    error_message,
    verified_at
  )
  SELECT
    id,
    connection_id,
    'onboarding',
    profile,
    reported_version,
    principal,
    scopes,
    capabilities,
    repositories,
    NULL,
    NULL,
    verified_at
  FROM forgejo_connection_verifications_v17;
  INSERT INTO forgejo_repositories (
    repository_id,
    connection_id,
    verification_id,
    forge_repository_id,
    name,
    api_url,
    web_url
  )
  SELECT
    repository_id,
    connection_id,
    verification_id,
    forge_repository_id,
    name,
    api_url,
    web_url
  FROM forgejo_repositories_v17;
  DROP TABLE forgejo_repositories_v17;
  DROP TABLE forgejo_connection_verifications_v17;
`;
