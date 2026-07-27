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
    created_at INTEGER NOT NULL,
    verified_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS github_connection_credentials (
    connection_id TEXT PRIMARY KEY REFERENCES github_connections(id),
    encrypted_credential TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS github_connection_verifications (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES github_connections(id),
    trigger TEXT NOT NULL CHECK (trigger IN ('onboarding')),
    api_profile TEXT NOT NULL,
    principal_id INTEGER NOT NULL CHECK (principal_id > 0),
    principal_login TEXT NOT NULL CHECK (length(principal_login) > 0),
    permissions TEXT NOT NULL CHECK (json_valid(permissions)),
    capabilities TEXT NOT NULL CHECK (json_valid(capabilities)),
    repositories TEXT NOT NULL CHECK (json_valid(repositories)),
    verified_at INTEGER NOT NULL
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS github_connection_verification_immutable_update
    BEFORE UPDATE ON github_connection_verifications
    BEGIN SELECT RAISE(ABORT, 'github_connection_verification_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS github_connection_verification_immutable_delete
    BEFORE DELETE ON github_connection_verifications
    BEGIN SELECT RAISE(ABORT, 'github_connection_verification_immutable'); END;
`;
