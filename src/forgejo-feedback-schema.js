export const FORGEJO_FEEDBACK_SCHEMA = `
  CREATE TABLE IF NOT EXISTS forgejo_commit_statuses (
    repository_id TEXT NOT NULL REFERENCES repositories(id),
    head_commit TEXT NOT NULL CHECK (
      length(head_commit) IN (40, 64)
      AND head_commit NOT GLOB '*[^0-9a-f]*'
    ),
    evaluation_id TEXT NOT NULL UNIQUE REFERENCES evaluations(id),
    desired_state TEXT NOT NULL
      CHECK (desired_state IN ('pending', 'success', 'failure', 'error')),
    publication_status TEXT NOT NULL
      CHECK (publication_status IN ('waiting', 'succeeded', 'unavailable')),
    published_state TEXT CHECK (
      published_state IS NULL
      OR published_state IN ('pending', 'success', 'failure', 'error')
    ),
    published_at INTEGER,
    external_id INTEGER CHECK (external_id IS NULL OR external_id > 0),
    error_code TEXT,
    error_detail TEXT,
    CHECK (
      (publication_status = 'waiting'
        AND published_state IS NULL
        AND published_at IS NULL
        AND external_id IS NULL
        AND error_code IS NULL
        AND error_detail IS NULL)
      OR
      (publication_status = 'succeeded'
        AND published_state = desired_state
        AND published_at IS NOT NULL
        AND external_id IS NOT NULL
        AND error_code IS NULL
        AND error_detail IS NULL)
      OR
      (publication_status = 'unavailable'
        AND published_state IS NULL
        AND published_at IS NULL
        AND external_id IS NULL
        AND error_code IS NOT NULL
        AND length(error_code) > 0
        AND error_detail IS NOT NULL
        AND length(trim(error_detail)) > 0)
    ),
    PRIMARY KEY (repository_id, head_commit)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS forgejo_commit_status_admit
    AFTER INSERT ON evaluations
    WHEN EXISTS (
      SELECT 1 FROM forgejo_repositories
      WHERE repository_id = NEW.repository_id
    )
    BEGIN
      INSERT INTO forgejo_commit_statuses (
        repository_id, head_commit, evaluation_id,
        desired_state, publication_status
      ) VALUES (
        NEW.repository_id, NEW.head_commit, NEW.id,
        'pending', 'waiting'
      )
      ON CONFLICT (repository_id, head_commit) DO UPDATE SET
        evaluation_id = excluded.evaluation_id,
        desired_state = 'pending',
        publication_status = 'waiting',
        published_state = NULL,
        published_at = NULL,
        external_id = NULL,
        error_code = NULL,
        error_detail = NULL
      WHERE
        (SELECT created_at FROM evaluations
          WHERE id = excluded.evaluation_id)
          >
        (SELECT created_at FROM evaluations
          WHERE id = forgejo_commit_statuses.evaluation_id)
        OR (
          (SELECT created_at FROM evaluations
            WHERE id = excluded.evaluation_id)
            =
          (SELECT created_at FROM evaluations
            WHERE id = forgejo_commit_statuses.evaluation_id)
          AND excluded.evaluation_id > forgejo_commit_statuses.evaluation_id
        );
    END;
  CREATE TRIGGER IF NOT EXISTS forgejo_commit_status_complete
    AFTER INSERT ON evaluation_results
    BEGIN
      UPDATE forgejo_commit_statuses
      SET desired_state = CASE NEW.outcome
            WHEN 'clear' THEN 'success'
            WHEN 'advisory' THEN 'failure'
            WHEN 'blocking' THEN 'failure'
            WHEN 'error' THEN 'error'
          END,
          publication_status = CASE
            WHEN EXISTS (
              SELECT 1
              FROM forgejo_repositories
              JOIN forgejo_connections
                ON forgejo_connections.id = forgejo_repositories.connection_id
              WHERE forgejo_repositories.repository_id =
                      forgejo_commit_statuses.repository_id
                AND forgejo_connections.lifecycle = 'retired'
            ) THEN 'unavailable'
            ELSE 'waiting'
          END,
          published_state = NULL,
          published_at = NULL,
          external_id = NULL,
          error_code = CASE
            WHEN EXISTS (
              SELECT 1
              FROM forgejo_repositories
              JOIN forgejo_connections
                ON forgejo_connections.id = forgejo_repositories.connection_id
              WHERE forgejo_repositories.repository_id =
                      forgejo_commit_statuses.repository_id
                AND forgejo_connections.lifecycle = 'retired'
            ) THEN 'forgejo_connection_retired'
            ELSE NULL
          END,
          error_detail = CASE
            WHEN EXISTS (
              SELECT 1
              FROM forgejo_repositories
              JOIN forgejo_connections
                ON forgejo_connections.id = forgejo_repositories.connection_id
              WHERE forgejo_repositories.repository_id =
                      forgejo_commit_statuses.repository_id
                AND forgejo_connections.lifecycle = 'retired'
            ) THEN
              'Forgejo commit status publication is unavailable because the Forgejo Connection is retired'
            ELSE NULL
          END
      WHERE evaluation_id = NEW.evaluation_id;
    END;
  INSERT INTO forgejo_commit_statuses (
    repository_id, head_commit, evaluation_id,
    desired_state, publication_status, error_code, error_detail
  )
  SELECT
    evaluations.repository_id,
    evaluations.head_commit,
    evaluations.id,
    CASE evaluation_results.outcome
      WHEN 'clear' THEN 'success'
      WHEN 'advisory' THEN 'failure'
      WHEN 'blocking' THEN 'failure'
      WHEN 'error' THEN 'error'
      ELSE 'pending'
    END,
    CASE forgejo_connections.lifecycle
      WHEN 'retired' THEN 'unavailable'
      ELSE 'waiting'
    END,
    CASE forgejo_connections.lifecycle
      WHEN 'retired' THEN 'forgejo_connection_retired'
      ELSE NULL
    END,
    CASE forgejo_connections.lifecycle
      WHEN 'retired' THEN
        'Forgejo commit status publication is unavailable because the Forgejo Connection is retired'
      ELSE NULL
    END
  FROM evaluations
  JOIN forgejo_repositories
    ON forgejo_repositories.repository_id = evaluations.repository_id
  JOIN forgejo_connections
    ON forgejo_connections.id = forgejo_repositories.connection_id
  LEFT JOIN evaluation_results
    ON evaluation_results.evaluation_id = evaluations.id
  WHERE true
  ORDER BY evaluations.created_at DESC, evaluations.id DESC
  ON CONFLICT (repository_id, head_commit) DO NOTHING;

  CREATE TABLE IF NOT EXISTS forgejo_feedback_bundles (
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
  CREATE TABLE IF NOT EXISTS forgejo_finding_feedback (
    finding_id TEXT PRIMARY KEY REFERENCES findings(id),
    evaluation_id TEXT NOT NULL REFERENCES forgejo_feedback_bundles(evaluation_id),
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
  CREATE TRIGGER IF NOT EXISTS forgejo_feedback_bundle_admit
    AFTER INSERT ON evaluation_results
    WHEN EXISTS (
      SELECT 1
      FROM forgejo_automatic_evaluations
      JOIN evaluations
        ON evaluations.id = forgejo_automatic_evaluations.evaluation_id
      JOIN forgejo_repositories
        ON forgejo_repositories.repository_id =
             forgejo_automatic_evaluations.repository_id
      WHERE forgejo_automatic_evaluations.evaluation_id = NEW.evaluation_id
        AND evaluations.execution_status != 'cancelled'
    )
    BEGIN
      INSERT INTO forgejo_feedback_bundles (
        evaluation_id, publication_status, error_code, error_detail
      )
      SELECT
        NEW.evaluation_id,
        CASE forgejo_connections.lifecycle
          WHEN 'retired' THEN 'unavailable'
          ELSE 'waiting'
        END,
        CASE forgejo_connections.lifecycle
          WHEN 'retired' THEN 'forgejo_connection_retired'
          ELSE NULL
        END,
        CASE forgejo_connections.lifecycle
          WHEN 'retired' THEN
            'Forgejo feedback publication is unavailable because the Forgejo Connection is retired'
          ELSE NULL
        END
      FROM forgejo_automatic_evaluations
      JOIN forgejo_repositories
        ON forgejo_repositories.repository_id =
             forgejo_automatic_evaluations.repository_id
      JOIN forgejo_connections
        ON forgejo_connections.id = forgejo_repositories.connection_id
      WHERE forgejo_automatic_evaluations.evaluation_id = NEW.evaluation_id;
    END;
  CREATE TRIGGER IF NOT EXISTS forgejo_feedback_bundle_identity_update
    BEFORE UPDATE OF evaluation_id ON forgejo_feedback_bundles
    BEGIN SELECT RAISE(ABORT, 'forgejo_feedback_bundle_identity_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS forgejo_feedback_bundle_publication_update
    BEFORE UPDATE OF
      publication_status, external_id, published_at, error_code, error_detail
    ON forgejo_feedback_bundles
    WHEN NOT (
      OLD.publication_status = 'waiting'
      AND NEW.publication_status IN ('succeeded', 'unavailable')
    )
    BEGIN SELECT RAISE(ABORT, 'forgejo_feedback_bundle_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS forgejo_feedback_bundle_delete
    BEFORE DELETE ON forgejo_feedback_bundles
    BEGIN SELECT RAISE(ABORT, 'forgejo_feedback_bundle_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS forgejo_finding_feedback_insert
    BEFORE INSERT ON forgejo_finding_feedback
    WHEN NOT EXISTS (
      SELECT 1
      FROM findings
      WHERE findings.id = NEW.finding_id
        AND findings.evaluation_id = NEW.evaluation_id
    )
    BEGIN
      SELECT RAISE(
        ABORT, 'forgejo_finding_feedback_evaluation_mismatch'
      );
    END;
  CREATE TRIGGER IF NOT EXISTS forgejo_finding_feedback_identity_update
    BEFORE UPDATE OF finding_id, evaluation_id
    ON forgejo_finding_feedback
    BEGIN SELECT RAISE(ABORT, 'forgejo_finding_feedback_identity_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS forgejo_finding_feedback_materialization_update
    BEFORE UPDATE OF
      publication_status, path, side, start_line, start_side, line,
      external_id, published_at, error_code, error_detail
    ON forgejo_finding_feedback
    WHEN
      NEW.path IS NOT OLD.path
      OR NEW.side IS NOT OLD.side
      OR NEW.start_line IS NOT OLD.start_line
      OR NEW.start_side IS NOT OLD.start_side
      OR NEW.line IS NOT OLD.line
      OR NOT (
        OLD.publication_status = 'waiting'
        AND NEW.publication_status IN ('succeeded', 'unavailable')
      )
    BEGIN
      SELECT RAISE(ABORT, 'forgejo_finding_feedback_immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS forgejo_finding_feedback_delete
    BEFORE DELETE ON forgejo_finding_feedback
    BEGIN SELECT RAISE(ABORT, 'forgejo_finding_feedback_immutable'); END;
  INSERT INTO forgejo_feedback_bundles (
    evaluation_id, publication_status, error_code, error_detail
  )
  SELECT
    evaluation_results.evaluation_id,
    CASE forgejo_connections.lifecycle
      WHEN 'retired' THEN 'unavailable'
      ELSE 'waiting'
    END,
    CASE forgejo_connections.lifecycle
      WHEN 'retired' THEN 'forgejo_connection_retired'
      ELSE NULL
    END,
    CASE forgejo_connections.lifecycle
      WHEN 'retired' THEN
        'Forgejo feedback publication is unavailable because the Forgejo Connection is retired'
      ELSE NULL
    END
  FROM evaluation_results
  JOIN evaluations
    ON evaluations.id = evaluation_results.evaluation_id
  JOIN forgejo_automatic_evaluations
    ON forgejo_automatic_evaluations.evaluation_id =
         evaluation_results.evaluation_id
  JOIN forgejo_repositories
    ON forgejo_repositories.repository_id =
         forgejo_automatic_evaluations.repository_id
  JOIN forgejo_connections
    ON forgejo_connections.id = forgejo_repositories.connection_id
  WHERE evaluations.execution_status != 'cancelled'
  ON CONFLICT (evaluation_id) DO NOTHING;
`;
