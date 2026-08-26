export const ONBOARDING_TOKEN_SCHEMA = `
  CREATE TABLE IF NOT EXISTS onboarding_tokens (
    id TEXT PRIMARY KEY,
    repository_url TEXT NOT NULL UNIQUE,
    verifier TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS onboarding_tokens_expiry
    ON onboarding_tokens (expires_at);
`;
