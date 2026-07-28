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
    profile TEXT NOT NULL CHECK (profile = 'forgejo-v16'),
    reported_version TEXT NOT NULL,
    principal TEXT NOT NULL CHECK (json_valid(principal)),
    scopes TEXT NOT NULL CHECK (json_valid(scopes)),
    capabilities TEXT NOT NULL CHECK (json_valid(capabilities)),
    repositories TEXT NOT NULL CHECK (json_valid(repositories)),
    verified_at INTEGER NOT NULL
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
`;
