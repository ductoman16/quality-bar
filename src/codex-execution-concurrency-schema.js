export const CODEX_EXECUTION_CONCURRENCY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS codex_execution_settings (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    maximum_running INTEGER NOT NULL
      CHECK (maximum_running BETWEEN 1 AND 4)
  ) STRICT;
  INSERT OR IGNORE INTO codex_execution_settings (
    singleton, maximum_running
  ) VALUES (1, 1);
`;
