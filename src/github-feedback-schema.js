export const GITHUB_FEEDBACK_SCHEMA = `
  CREATE TABLE IF NOT EXISTS github_feedback_bundles (
    evaluation_id TEXT PRIMARY KEY REFERENCES evaluation_results(evaluation_id),
    publication_status TEXT NOT NULL
      CHECK (publication_status IN ('waiting', 'succeeded', 'unavailable')),
    external_id INTEGER CHECK (external_id IS NULL OR external_id > 0),
    published_at INTEGER,
    error_code TEXT,
    error_detail TEXT,
    CHECK (
      (publication_status = 'waiting'
        AND external_id IS NULL AND published_at IS NULL
        AND error_code IS NULL AND error_detail IS NULL)
      OR
      (publication_status = 'succeeded'
        AND external_id IS NOT NULL AND published_at IS NOT NULL
        AND error_code IS NULL AND error_detail IS NULL)
      OR
      (publication_status = 'unavailable'
        AND external_id IS NULL AND published_at IS NULL
        AND error_code IS NOT NULL AND length(error_code) > 0
        AND error_detail IS NOT NULL AND length(trim(error_detail)) > 0)
    )
  ) STRICT;
  CREATE TABLE IF NOT EXISTS github_finding_feedback (
    finding_id TEXT PRIMARY KEY REFERENCES findings(id),
    evaluation_id TEXT NOT NULL REFERENCES github_feedback_bundles(evaluation_id),
    publication_status TEXT NOT NULL CHECK (
      publication_status IN (
        'aggregate_only', 'waiting', 'succeeded', 'unavailable'
      )
    ),
    path TEXT,
    side TEXT CHECK (side IN ('LEFT', 'RIGHT')),
    start_line INTEGER CHECK (start_line IS NULL OR start_line > 0),
    start_side TEXT CHECK (start_side IN ('LEFT', 'RIGHT')),
    line INTEGER CHECK (line IS NULL OR line > 0),
    external_id INTEGER CHECK (external_id IS NULL OR external_id > 0),
    published_at INTEGER,
    error_code TEXT,
    error_detail TEXT,
    CHECK (
      (publication_status = 'aggregate_only'
        AND path IS NULL AND side IS NULL
        AND start_line IS NULL AND start_side IS NULL AND line IS NULL
        AND external_id IS NULL AND published_at IS NULL
        AND error_code IS NULL AND error_detail IS NULL)
      OR
      (publication_status IN ('waiting', 'succeeded', 'unavailable')
        AND path IS NOT NULL AND length(path) > 0
        AND side IS NOT NULL AND line IS NOT NULL
        AND (
          (start_line IS NULL AND start_side IS NULL)
          OR (start_line IS NOT NULL AND start_side IS NOT NULL)
        )
        AND (
          (publication_status = 'waiting'
            AND external_id IS NULL AND published_at IS NULL
            AND error_code IS NULL AND error_detail IS NULL)
          OR
          (publication_status = 'succeeded'
            AND external_id IS NOT NULL AND published_at IS NOT NULL
            AND error_code IS NULL AND error_detail IS NULL)
          OR
          (publication_status = 'unavailable'
            AND external_id IS NULL AND published_at IS NULL
            AND error_code IS NOT NULL AND length(error_code) > 0
            AND error_detail IS NOT NULL AND length(trim(error_detail)) > 0)
        )
      )
    )
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS github_feedback_bundle_admit
    AFTER INSERT ON evaluation_results
    WHEN EXISTS (
      SELECT 1
      FROM github_automatic_evaluations
      JOIN evaluations
        ON evaluations.id = github_automatic_evaluations.evaluation_id
      JOIN github_repositories
        ON github_repositories.repository_id =
             github_automatic_evaluations.repository_id
      WHERE github_automatic_evaluations.evaluation_id = NEW.evaluation_id
        AND evaluations.execution_status != 'cancelled'
    )
    BEGIN
      INSERT INTO github_feedback_bundles (
        evaluation_id, publication_status, error_code, error_detail
      )
      SELECT
        NEW.evaluation_id,
        CASE github_connections.lifecycle
          WHEN 'retired' THEN 'unavailable'
          ELSE 'waiting'
        END,
        CASE github_connections.lifecycle
          WHEN 'retired' THEN 'github_connection_retired'
          ELSE NULL
        END,
        CASE github_connections.lifecycle
          WHEN 'retired' THEN
            'GitHub feedback publication is unavailable because the GitHub Connection is retired'
          ELSE NULL
        END
      FROM github_automatic_evaluations
      JOIN github_repositories
        ON github_repositories.repository_id =
             github_automatic_evaluations.repository_id
      JOIN github_connections
        ON github_connections.id = github_repositories.connection_id
      WHERE github_automatic_evaluations.evaluation_id = NEW.evaluation_id;
    END;
  CREATE TRIGGER IF NOT EXISTS github_feedback_bundle_identity_update
    BEFORE UPDATE OF evaluation_id ON github_feedback_bundles
    BEGIN SELECT RAISE(ABORT, 'github_feedback_bundle_identity_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS github_feedback_bundle_delete
    BEFORE DELETE ON github_feedback_bundles
    BEGIN SELECT RAISE(ABORT, 'github_feedback_bundle_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS github_finding_feedback_identity_update
    BEFORE UPDATE OF finding_id, evaluation_id
    ON github_finding_feedback
    BEGIN SELECT RAISE(ABORT, 'github_finding_feedback_identity_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS github_finding_feedback_delete
    BEFORE DELETE ON github_finding_feedback
    BEGIN SELECT RAISE(ABORT, 'github_finding_feedback_immutable'); END;
  INSERT INTO github_feedback_bundles (
    evaluation_id, publication_status, error_code, error_detail
  )
  SELECT
    evaluation_results.evaluation_id,
    CASE github_connections.lifecycle
      WHEN 'retired' THEN 'unavailable'
      ELSE 'waiting'
    END,
    CASE github_connections.lifecycle
      WHEN 'retired' THEN 'github_connection_retired'
      ELSE NULL
    END,
    CASE github_connections.lifecycle
      WHEN 'retired' THEN
        'GitHub feedback publication is unavailable because the GitHub Connection is retired'
      ELSE NULL
    END
  FROM evaluation_results
  JOIN evaluations
    ON evaluations.id = evaluation_results.evaluation_id
  JOIN github_automatic_evaluations
    ON github_automatic_evaluations.evaluation_id =
         evaluation_results.evaluation_id
  JOIN github_repositories
    ON github_repositories.repository_id =
         github_automatic_evaluations.repository_id
  JOIN github_connections
    ON github_connections.id = github_repositories.connection_id
  WHERE evaluations.execution_status != 'cancelled'
  ON CONFLICT (evaluation_id) DO NOTHING;
`;
