import * as legacy from "./forgejo-delivery-migration-classification.js";

export const FORGEJO_DELIVERY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS forgejo_delivery_attempts (
    surface TEXT NOT NULL CHECK (
      surface IN ('commit_status', 'aggregate_feedback', 'inline_feedback')
    ),
    source_id TEXT NOT NULL CHECK (length(source_id) > 0),
    target TEXT NOT NULL CHECK (length(target) > 0),
    generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
    connection_id TEXT REFERENCES forgejo_connections(id),
    authority_verified_at INTEGER CHECK (
      authority_verified_at IS NULL OR authority_verified_at >= 0
    ),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_attempt_at INTEGER,
    next_attempt_at INTEGER NOT NULL DEFAULT 0 CHECK (next_attempt_at >= 0),
    reconciliation_required INTEGER NOT NULL DEFAULT 0
      CHECK (reconciliation_required IN (0, 1)),
    external_id INTEGER CHECK (external_id IS NULL OR external_id > 0),
    error_code TEXT,
    error_detail TEXT,
    response_status INTEGER CHECK (
      response_status IS NULL OR response_status BETWEEN 100 AND 599
    ),
    definitive INTEGER NOT NULL DEFAULT 0 CHECK (definitive IN (0, 1)),
    CHECK (
      (attempt_count = 0 AND last_attempt_at IS NULL) OR attempt_count > 0
    ),
    CHECK (
      (error_code IS NULL AND error_detail IS NULL)
      OR (length(error_code) > 0 AND length(trim(error_detail)) > 0)
    ),
    CHECK (definitive = 0 OR error_code IS NOT NULL),
    CHECK (
      (connection_id IS NULL AND authority_verified_at IS NULL)
      OR (connection_id IS NOT NULL AND authority_verified_at IS NOT NULL)
    ),
    PRIMARY KEY (surface, source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS forgejo_delivery_due
    ON forgejo_delivery_attempts
       (definitive, next_attempt_at, surface, source_id);
  CREATE TABLE IF NOT EXISTS forgejo_delivery_provider_gates (
    connection_id TEXT PRIMARY KEY REFERENCES forgejo_connections(id),
    gate_until INTEGER NOT NULL CHECK (gate_until >= 0),
    error_code TEXT NOT NULL CHECK (length(error_code) > 0),
    error_detail TEXT NOT NULL CHECK (length(trim(error_detail)) > 0)
  ) STRICT;
  DROP TRIGGER IF EXISTS forgejo_feedback_bundle_publication_update;
  CREATE TRIGGER forgejo_feedback_bundle_publication_update
    BEFORE UPDATE OF
      publication_status, external_id, published_at, error_code, error_detail
    ON forgejo_feedback_bundles
    WHEN NOT (
      (
        OLD.publication_status = 'waiting'
        AND NEW.publication_status IN ('succeeded', 'unavailable')
      )
      OR (
        OLD.publication_status = 'unavailable'
        AND NEW.publication_status = 'waiting'
        AND NEW.external_id IS NULL AND NEW.published_at IS NULL
        AND NEW.error_code IS NULL AND NEW.error_detail IS NULL
        AND EXISTS (
          SELECT 1 FROM forgejo_delivery_attempts
          WHERE surface = 'aggregate_feedback'
            AND source_id = OLD.evaluation_id
            AND definitive = 0
            AND (error_code IS NULL OR reconciliation_required = 1)
        )
      )
    )
    BEGIN SELECT RAISE(ABORT, 'forgejo_feedback_bundle_immutable'); END;
  DROP TRIGGER IF EXISTS forgejo_finding_feedback_materialization_update;
  CREATE TRIGGER forgejo_finding_feedback_materialization_update
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
        (
          OLD.publication_status = 'waiting'
          AND NEW.publication_status IN ('succeeded', 'unavailable')
        )
        OR (
          OLD.publication_status = 'unavailable'
          AND NEW.publication_status = 'waiting'
          AND NEW.external_id IS NULL AND NEW.published_at IS NULL
          AND NEW.error_code IS NULL AND NEW.error_detail IS NULL
          AND EXISTS (
            SELECT 1 FROM forgejo_delivery_attempts
            WHERE surface = 'inline_feedback'
              AND source_id = OLD.finding_id
              AND definitive = 0
              AND (error_code IS NULL OR reconciliation_required = 1)
          )
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'forgejo_finding_feedback_immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS forgejo_commit_status_delivery_admit
    AFTER INSERT ON forgejo_commit_statuses
    BEGIN
      INSERT INTO forgejo_delivery_attempts (
        surface, source_id, target, connection_id, authority_verified_at,
        error_code, error_detail, definitive
      )
      SELECT
        'commit_status', NEW.evaluation_id || ':' || NEW.desired_state,
        json_object(
          'context', 'Quality Bar', 'head_commit', NEW.head_commit,
          'repository_id', (
            SELECT forge_repository_id FROM forgejo_repositories
            WHERE repository_id = NEW.repository_id
          ), 'state', NEW.desired_state
        ),
        CASE WHEN NEW.error_code = 'forgejo_connection_retired'
          THEN forgejo_connections.id ELSE NULL END,
        CASE WHEN NEW.error_code = 'forgejo_connection_retired'
          THEN forgejo_connections.verified_at ELSE NULL END,
        NEW.error_code, NEW.error_detail,
        CASE WHEN NEW.error_code = 'forgejo_connection_retired' THEN 1 ELSE 0 END
      FROM forgejo_repositories
      JOIN forgejo_connections
        ON forgejo_connections.id = forgejo_repositories.connection_id
      WHERE forgejo_repositories.repository_id = NEW.repository_id
      ON CONFLICT (surface, source_id) DO NOTHING;
    END;
  CREATE TRIGGER IF NOT EXISTS forgejo_commit_status_delivery_update_admit
    AFTER UPDATE OF evaluation_id, desired_state ON forgejo_commit_statuses
    BEGIN
      INSERT INTO forgejo_delivery_attempts (
        surface, source_id, target, connection_id, authority_verified_at,
        error_code, error_detail, definitive
      )
      SELECT
        'commit_status', NEW.evaluation_id || ':' || NEW.desired_state,
        json_object(
          'context', 'Quality Bar', 'head_commit', NEW.head_commit,
          'repository_id', (
            SELECT forge_repository_id FROM forgejo_repositories
            WHERE repository_id = NEW.repository_id
          ), 'state', NEW.desired_state
        ),
        CASE WHEN NEW.error_code = 'forgejo_connection_retired'
          THEN forgejo_connections.id ELSE NULL END,
        CASE WHEN NEW.error_code = 'forgejo_connection_retired'
          THEN forgejo_connections.verified_at ELSE NULL END,
        NEW.error_code, NEW.error_detail,
        CASE WHEN NEW.error_code = 'forgejo_connection_retired' THEN 1 ELSE 0 END
      FROM forgejo_repositories
      JOIN forgejo_connections
        ON forgejo_connections.id = forgejo_repositories.connection_id
      WHERE forgejo_repositories.repository_id = NEW.repository_id
      ON CONFLICT (surface, source_id) DO UPDATE SET
        target = excluded.target,
        connection_id = excluded.connection_id,
        authority_verified_at = excluded.authority_verified_at,
        error_code = excluded.error_code,
        error_detail = excluded.error_detail,
        definitive = excluded.definitive
      WHERE forgejo_delivery_attempts.attempt_count = 0
        AND forgejo_delivery_attempts.external_id IS NULL;
    END;
  CREATE TRIGGER IF NOT EXISTS forgejo_feedback_bundle_delivery_admit
    AFTER INSERT ON forgejo_feedback_bundles
    BEGIN
      INSERT INTO forgejo_delivery_attempts (
        surface, source_id, target, connection_id, authority_verified_at,
        error_code, error_detail, definitive
      )
      SELECT 'aggregate_feedback', NEW.evaluation_id,
             json_object(
               'pull_request_number',
                 forgejo_automatic_evaluations.pull_request_number,
               'repository_id', forgejo_repositories.forge_repository_id
             ),
             CASE WHEN NEW.error_code = 'forgejo_connection_retired'
               THEN forgejo_connections.id ELSE NULL END,
             CASE WHEN NEW.error_code = 'forgejo_connection_retired'
               THEN forgejo_connections.verified_at ELSE NULL END,
             NEW.error_code, NEW.error_detail,
             CASE WHEN NEW.error_code = 'forgejo_connection_retired'
               THEN 1 ELSE 0 END
      FROM forgejo_automatic_evaluations
      JOIN forgejo_repositories
        ON forgejo_repositories.repository_id =
             forgejo_automatic_evaluations.repository_id
      JOIN forgejo_connections
        ON forgejo_connections.id = forgejo_repositories.connection_id
      WHERE forgejo_automatic_evaluations.evaluation_id = NEW.evaluation_id
      ON CONFLICT (surface, source_id) DO NOTHING;
    END;
  CREATE TRIGGER IF NOT EXISTS forgejo_finding_feedback_delivery_admit
    AFTER INSERT ON forgejo_finding_feedback
    WHEN NEW.publication_status != 'aggregate_only'
    BEGIN
      INSERT INTO forgejo_delivery_attempts (
        surface, source_id, target, connection_id, authority_verified_at,
        error_code, error_detail, definitive
      )
      SELECT 'inline_feedback', NEW.finding_id,
             json_object(
               'line', NEW.line, 'path', NEW.path,
               'pull_request_number',
                 forgejo_automatic_evaluations.pull_request_number,
               'repository_id', forgejo_repositories.forge_repository_id,
               'side', NEW.side, 'start_line', NEW.start_line,
               'start_side', NEW.start_side
             ),
             CASE WHEN NEW.error_code = 'forgejo_connection_retired'
               THEN forgejo_connections.id ELSE NULL END,
             CASE WHEN NEW.error_code = 'forgejo_connection_retired'
               THEN forgejo_connections.verified_at ELSE NULL END,
             NEW.error_code, NEW.error_detail,
             CASE WHEN NEW.error_code = 'forgejo_connection_retired'
               THEN 1 ELSE 0 END
      FROM forgejo_automatic_evaluations
      JOIN forgejo_repositories
        ON forgejo_repositories.repository_id =
             forgejo_automatic_evaluations.repository_id
      JOIN forgejo_connections
        ON forgejo_connections.id = forgejo_repositories.connection_id
      WHERE forgejo_automatic_evaluations.evaluation_id = NEW.evaluation_id
      ON CONFLICT (surface, source_id) DO NOTHING;
    END;
  INSERT INTO forgejo_delivery_attempts (
    surface, source_id, target, connection_id, authority_verified_at,
    attempt_count, last_attempt_at, reconciliation_required, external_id,
    error_code, error_detail, definitive
  )
  SELECT 'commit_status', evaluation_id || ':' || desired_state,
         json_object(
           'context', 'Quality Bar', 'head_commit', head_commit,
           'repository_id', forgejo_repositories.forge_repository_id,
           'state', desired_state
         ),
         CASE WHEN publication_status = 'waiting'
           THEN NULL ELSE forgejo_connections.id END,
         CASE WHEN publication_status = 'waiting'
           THEN NULL ELSE forgejo_connections.verified_at END,
         CASE WHEN publication_status = 'waiting' THEN 0 ELSE 1 END,
         published_at,
         CASE WHEN publication_status = 'waiting'
                    OR (publication_status = 'unavailable'
               AND NOT (
                 error_code IN (${legacy.DEFINITIVE_FAILURE_CODES})
                 OR ${legacy.DEFINITIVE_REQUEST}
               ))
              THEN 1 ELSE 0 END,
         external_id, error_code, error_detail,
         CASE WHEN publication_status = 'unavailable'
               AND (
                 error_code IN (${legacy.DEFINITIVE_FAILURE_CODES})
                 OR ${legacy.DEFINITIVE_REQUEST}
               )
              THEN 1 ELSE 0 END
  FROM forgejo_commit_statuses
  JOIN forgejo_repositories
    ON forgejo_repositories.repository_id =
         forgejo_commit_statuses.repository_id
  JOIN forgejo_connections
    ON forgejo_connections.id = forgejo_repositories.connection_id
  WHERE publication_status IN ('waiting', 'succeeded', 'unavailable')
  ON CONFLICT (surface, source_id) DO NOTHING;
  INSERT INTO forgejo_delivery_attempts (
    surface, source_id, target, connection_id, authority_verified_at,
    attempt_count, last_attempt_at, reconciliation_required, external_id,
    error_code, error_detail, definitive
  )
  SELECT 'aggregate_feedback', forgejo_feedback_bundles.evaluation_id,
         json_object(
           'pull_request_number',
             forgejo_automatic_evaluations.pull_request_number,
           'repository_id', forgejo_repositories.forge_repository_id
         ),
         CASE WHEN publication_status = 'waiting'
           THEN NULL ELSE forgejo_connections.id END,
         CASE WHEN publication_status = 'waiting'
           THEN NULL ELSE forgejo_connections.verified_at END,
         CASE WHEN publication_status = 'waiting' THEN 0 ELSE 1 END,
         forgejo_feedback_bundles.published_at,
         CASE WHEN publication_status = 'waiting'
                    OR (publication_status = 'unavailable'
               AND NOT (
                 error_code IN (${legacy.DEFINITIVE_FAILURE_CODES})
                 OR ${legacy.DEFINITIVE_REQUEST}
               ))
              THEN 1 ELSE 0 END,
         forgejo_feedback_bundles.external_id,
         forgejo_feedback_bundles.error_code,
         forgejo_feedback_bundles.error_detail,
         CASE WHEN publication_status = 'unavailable'
               AND (
                 error_code IN (${legacy.DEFINITIVE_FAILURE_CODES})
                 OR ${legacy.DEFINITIVE_REQUEST}
               )
              THEN 1 ELSE 0 END
  FROM forgejo_feedback_bundles
  JOIN forgejo_automatic_evaluations
    ON forgejo_automatic_evaluations.evaluation_id =
         forgejo_feedback_bundles.evaluation_id
  JOIN forgejo_repositories
    ON forgejo_repositories.repository_id =
         forgejo_automatic_evaluations.repository_id
  JOIN forgejo_connections
    ON forgejo_connections.id = forgejo_repositories.connection_id
  WHERE publication_status IN ('waiting', 'succeeded', 'unavailable')
  ON CONFLICT (surface, source_id) DO NOTHING;
  INSERT INTO forgejo_delivery_attempts (
    surface, source_id, target, connection_id, authority_verified_at,
    attempt_count, last_attempt_at, reconciliation_required, external_id,
    error_code, error_detail, definitive
  )
  SELECT 'inline_feedback', forgejo_finding_feedback.finding_id,
         json_object(
           'line', forgejo_finding_feedback.line,
           'path', forgejo_finding_feedback.path,
           'pull_request_number',
             forgejo_automatic_evaluations.pull_request_number,
           'repository_id', forgejo_repositories.forge_repository_id,
           'side', forgejo_finding_feedback.side,
           'start_line', forgejo_finding_feedback.start_line,
           'start_side', forgejo_finding_feedback.start_side
         ),
         CASE WHEN publication_status = 'waiting'
           THEN NULL ELSE forgejo_connections.id END,
         CASE WHEN publication_status = 'waiting'
           THEN NULL ELSE forgejo_connections.verified_at END,
         CASE WHEN publication_status = 'waiting' THEN 0 ELSE 1 END,
         forgejo_finding_feedback.published_at,
         CASE WHEN publication_status = 'waiting'
                    OR (publication_status = 'unavailable'
               AND NOT (
                 error_code IN (${legacy.DEFINITIVE_FAILURE_CODES})
                 OR ${legacy.DEFINITIVE_REQUEST}
               ))
              THEN 1 ELSE 0 END,
         forgejo_finding_feedback.external_id,
         forgejo_finding_feedback.error_code,
         forgejo_finding_feedback.error_detail,
         CASE WHEN publication_status = 'unavailable'
               AND (
                 error_code IN (${legacy.DEFINITIVE_FAILURE_CODES})
                 OR ${legacy.DEFINITIVE_REQUEST}
               )
              THEN 1 ELSE 0 END
  FROM forgejo_finding_feedback
  JOIN forgejo_automatic_evaluations
    ON forgejo_automatic_evaluations.evaluation_id =
         forgejo_finding_feedback.evaluation_id
  JOIN forgejo_repositories
    ON forgejo_repositories.repository_id =
         forgejo_automatic_evaluations.repository_id
  JOIN forgejo_connections
    ON forgejo_connections.id = forgejo_repositories.connection_id
  WHERE publication_status IN ('waiting', 'succeeded', 'unavailable')
  ON CONFLICT (surface, source_id) DO NOTHING;
  UPDATE forgejo_commit_statuses
  SET publication_status = 'waiting', published_state = NULL,
      published_at = NULL, external_id = NULL,
      error_code = NULL, error_detail = NULL
  WHERE publication_status = 'unavailable'
    AND EXISTS (
      SELECT 1 FROM forgejo_delivery_attempts
      WHERE surface = 'commit_status'
        AND source_id =
              forgejo_commit_statuses.evaluation_id || ':' ||
              forgejo_commit_statuses.desired_state
        AND reconciliation_required = 1 AND definitive = 0
    );
  UPDATE forgejo_feedback_bundles
  SET publication_status = 'waiting', external_id = NULL,
      published_at = NULL, error_code = NULL, error_detail = NULL
  WHERE publication_status = 'unavailable'
    AND EXISTS (
      SELECT 1 FROM forgejo_delivery_attempts
      WHERE surface = 'aggregate_feedback'
        AND source_id = forgejo_feedback_bundles.evaluation_id
        AND reconciliation_required = 1 AND definitive = 0
    );
  UPDATE forgejo_finding_feedback
  SET publication_status = 'waiting', external_id = NULL,
      published_at = NULL, error_code = NULL, error_detail = NULL
  WHERE publication_status = 'unavailable'
    AND EXISTS (
      SELECT 1 FROM forgejo_delivery_attempts
      WHERE surface = 'inline_feedback'
        AND source_id = forgejo_finding_feedback.finding_id
        AND reconciliation_required = 1 AND definitive = 0
    );
`;
