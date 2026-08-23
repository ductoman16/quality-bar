export const REPOSITORY_CREDENTIAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS repository_credentials (
    repository_id TEXT PRIMARY KEY REFERENCES repositories(id),
    encrypted_credential TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
`;
