export const GITHUB_DELIVERY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS github_delivery_attempts (
    surface TEXT NOT NULL CHECK (
      surface IN ('commit_status', 'aggregate_feedback', 'inline_feedback')
    ),
    source_id TEXT NOT NULL CHECK (length(source_id) > 0),
    target TEXT NOT NULL CHECK (length(target) > 0),
    generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
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
      (attempt_count = 0 AND last_attempt_at IS NULL)
      OR (attempt_count > 0 AND last_attempt_at IS NOT NULL)
    ),
    CHECK (
      (error_code IS NULL AND error_detail IS NULL)
      OR (
        error_code IS NOT NULL AND length(error_code) > 0
        AND error_detail IS NOT NULL AND length(trim(error_detail)) > 0
      )
    ),
    CHECK (definitive = 0 OR error_code IS NOT NULL),
    PRIMARY KEY (surface, source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS github_delivery_due
    ON github_delivery_attempts (definitive, next_attempt_at, surface, source_id);
  CREATE TABLE IF NOT EXISTS github_delivery_provider_gates (
    connection_id TEXT PRIMARY KEY REFERENCES github_connections(id),
    gate_until INTEGER NOT NULL CHECK (gate_until >= 0),
    error_code TEXT NOT NULL CHECK (length(error_code) > 0),
    error_detail TEXT NOT NULL CHECK (length(trim(error_detail)) > 0)
  ) STRICT;
  DROP TRIGGER IF EXISTS github_feedback_bundle_publication_update;
  CREATE TRIGGER github_feedback_bundle_publication_update
    BEFORE UPDATE OF
      publication_status, external_id, published_at, error_code, error_detail
    ON github_feedback_bundles
    WHEN NOT (
      (
        OLD.publication_status = 'waiting'
        AND NEW.publication_status IN ('succeeded', 'unavailable')
      )
      OR (
        OLD.publication_status = 'unavailable'
        AND NEW.publication_status = 'waiting'
        AND NEW.external_id IS NULL
        AND NEW.published_at IS NULL
        AND NEW.error_code IS NULL
        AND NEW.error_detail IS NULL
      )
    )
    BEGIN SELECT RAISE(ABORT, 'github_feedback_bundle_immutable'); END;
  DROP TRIGGER IF EXISTS github_finding_feedback_materialization_update;
  CREATE TRIGGER github_finding_feedback_materialization_update
    BEFORE UPDATE OF
      publication_status, path, side, start_line, start_side, line,
      external_id, published_at, error_code, error_detail
    ON github_finding_feedback
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
          AND NEW.external_id IS NULL
          AND NEW.published_at IS NULL
          AND NEW.error_code IS NULL
          AND NEW.error_detail IS NULL
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'github_finding_feedback_immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS github_commit_status_delivery_admit
    AFTER INSERT ON github_commit_statuses
    BEGIN
      INSERT INTO github_delivery_attempts (
        surface, source_id, target
      ) VALUES (
        'commit_status',
        NEW.evaluation_id || ':' || NEW.desired_state,
        json_object(
          'context', 'Quality Bar',
          'head_commit', NEW.head_commit,
          'repository_id', NEW.repository_id,
          'state', NEW.desired_state
        )
      ) ON CONFLICT (surface, source_id) DO NOTHING;
    END;
  CREATE TRIGGER IF NOT EXISTS github_commit_status_delivery_update_admit
    AFTER UPDATE OF evaluation_id, desired_state ON github_commit_statuses
    BEGIN
      INSERT INTO github_delivery_attempts (
        surface, source_id, target
      ) VALUES (
        'commit_status',
        NEW.evaluation_id || ':' || NEW.desired_state,
        json_object(
          'context', 'Quality Bar',
          'head_commit', NEW.head_commit,
          'repository_id', NEW.repository_id,
          'state', NEW.desired_state
        )
      ) ON CONFLICT (surface, source_id) DO NOTHING;
    END;
  CREATE TRIGGER IF NOT EXISTS github_feedback_bundle_delivery_admit
    AFTER INSERT ON github_feedback_bundles
    BEGIN
      INSERT INTO github_delivery_attempts (
        surface, source_id, target
      )
      SELECT
        'aggregate_feedback',
        NEW.evaluation_id,
        json_object(
          'pull_request_number',
            github_automatic_evaluations.pull_request_number,
          'repository_id', github_repositories.forge_repository_id
        )
      FROM github_automatic_evaluations
      JOIN github_repositories
        ON github_repositories.repository_id =
             github_automatic_evaluations.repository_id
      WHERE github_automatic_evaluations.evaluation_id = NEW.evaluation_id
      ON CONFLICT (surface, source_id) DO NOTHING;
    END;
  CREATE TRIGGER IF NOT EXISTS github_finding_feedback_delivery_admit
    AFTER INSERT ON github_finding_feedback
    WHEN NEW.publication_status != 'aggregate_only'
    BEGIN
      INSERT INTO github_delivery_attempts (
        surface, source_id, target
      )
      SELECT
        'inline_feedback',
        NEW.finding_id,
        json_object(
          'line', NEW.line,
          'path', NEW.path,
          'pull_request_number',
            github_automatic_evaluations.pull_request_number,
          'repository_id', github_repositories.forge_repository_id,
          'side', NEW.side,
          'start_line', NEW.start_line,
          'start_side', NEW.start_side
        )
      FROM github_automatic_evaluations
      JOIN github_repositories
        ON github_repositories.repository_id =
             github_automatic_evaluations.repository_id
      WHERE github_automatic_evaluations.evaluation_id = NEW.evaluation_id
      ON CONFLICT (surface, source_id) DO NOTHING;
    END;
  INSERT INTO github_delivery_attempts (
    surface, source_id, target, attempt_count, last_attempt_at,
    reconciliation_required, external_id, error_code, error_detail, definitive
  )
  SELECT
    'commit_status',
    evaluation_id || ':' || desired_state,
    json_object(
      'context', 'Quality Bar',
      'head_commit', head_commit,
      'repository_id', repository_id,
      'state', desired_state
    ),
    CASE WHEN publication_status = 'succeeded' THEN 1 ELSE 0 END,
    CASE WHEN publication_status = 'succeeded' THEN published_at ELSE NULL END,
    CASE WHEN publication_status = 'unavailable' THEN 1 ELSE 0 END,
    NULL,
    error_code,
    error_detail,
    CASE WHEN error_code IN (
      'github_api_request_failed',
      'github_app_profile_mismatch',
      'github_connection_credential_invalid',
      'github_connection_credential_undecryptable',
      'github_connection_retired',
      'github_delivery_identity_conflict',
      'github_installation_scope_invalid',
      'github_permissions_mismatch',
      'github_principal_mismatch',
      'github_repository_api_access_failed'
    ) THEN 1 ELSE 0 END
  FROM github_commit_statuses
  WHERE true
  ON CONFLICT (surface, source_id) DO NOTHING;
  INSERT INTO github_delivery_attempts (
    surface, source_id, target, attempt_count, last_attempt_at,
    reconciliation_required, external_id, error_code, error_detail, definitive
  )
  SELECT
    'aggregate_feedback',
    github_feedback_bundles.evaluation_id,
    json_object(
      'pull_request_number',
        github_automatic_evaluations.pull_request_number,
      'repository_id', github_repositories.forge_repository_id
    ),
    CASE WHEN github_feedback_bundles.publication_status = 'succeeded'
      THEN 1 ELSE 0 END,
    CASE WHEN github_feedback_bundles.publication_status = 'succeeded'
      THEN github_feedback_bundles.published_at ELSE NULL END,
    CASE WHEN github_feedback_bundles.publication_status = 'unavailable'
      THEN 1 ELSE 0 END,
    github_feedback_bundles.external_id,
    github_feedback_bundles.error_code,
    github_feedback_bundles.error_detail,
    CASE WHEN github_feedback_bundles.error_code IN (
      'github_api_request_failed',
      'github_app_profile_mismatch',
      'github_connection_credential_invalid',
      'github_connection_credential_undecryptable',
      'github_connection_retired',
      'github_delivery_identity_conflict',
      'github_installation_scope_invalid',
      'github_permissions_mismatch',
      'github_principal_mismatch',
      'github_repository_api_access_failed'
    ) THEN 1 ELSE 0 END
  FROM github_feedback_bundles
  JOIN github_automatic_evaluations
    ON github_automatic_evaluations.evaluation_id =
         github_feedback_bundles.evaluation_id
  JOIN github_repositories
    ON github_repositories.repository_id =
         github_automatic_evaluations.repository_id
  WHERE true
  ON CONFLICT (surface, source_id) DO NOTHING;
  INSERT INTO github_delivery_attempts (
    surface, source_id, target, attempt_count, last_attempt_at,
    reconciliation_required, external_id, error_code, error_detail, definitive
  )
  SELECT
    'inline_feedback',
    github_finding_feedback.finding_id,
    json_object(
      'line', github_finding_feedback.line,
      'path', github_finding_feedback.path,
      'pull_request_number',
        github_automatic_evaluations.pull_request_number,
      'repository_id', github_repositories.forge_repository_id,
      'side', github_finding_feedback.side,
      'start_line', github_finding_feedback.start_line,
      'start_side', github_finding_feedback.start_side
    ),
    CASE WHEN github_finding_feedback.publication_status = 'succeeded'
      THEN 1 ELSE 0 END,
    CASE WHEN github_finding_feedback.publication_status = 'succeeded'
      THEN github_finding_feedback.published_at ELSE NULL END,
    CASE WHEN github_finding_feedback.publication_status = 'unavailable'
      THEN 1 ELSE 0 END,
    github_finding_feedback.external_id,
    github_finding_feedback.error_code,
    github_finding_feedback.error_detail,
    CASE WHEN github_finding_feedback.error_code IN (
      'github_api_request_failed',
      'github_app_profile_mismatch',
      'github_connection_credential_invalid',
      'github_connection_credential_undecryptable',
      'github_connection_retired',
      'github_delivery_identity_conflict',
      'github_installation_scope_invalid',
      'github_permissions_mismatch',
      'github_principal_mismatch',
      'github_repository_api_access_failed'
    ) THEN 1 ELSE 0 END
  FROM github_finding_feedback
  JOIN github_automatic_evaluations
    ON github_automatic_evaluations.evaluation_id =
         github_finding_feedback.evaluation_id
  JOIN github_repositories
    ON github_repositories.repository_id =
         github_automatic_evaluations.repository_id
  WHERE github_finding_feedback.publication_status != 'aggregate_only'
  ON CONFLICT (surface, source_id) DO NOTHING;
  UPDATE github_commit_statuses
  SET publication_status = 'waiting', error_code = NULL, error_detail = NULL
  WHERE publication_status = 'unavailable'
    AND error_code NOT IN (
      'github_api_request_failed',
      'github_app_profile_mismatch',
      'github_connection_credential_invalid',
      'github_connection_credential_undecryptable',
      'github_connection_retired',
      'github_delivery_identity_conflict',
      'github_installation_scope_invalid',
      'github_permissions_mismatch',
      'github_principal_mismatch',
      'github_repository_api_access_failed'
    );
  UPDATE github_feedback_bundles
  SET publication_status = 'waiting', error_code = NULL, error_detail = NULL
  WHERE publication_status = 'unavailable'
    AND error_code NOT IN (
      'github_api_request_failed',
      'github_app_profile_mismatch',
      'github_connection_credential_invalid',
      'github_connection_credential_undecryptable',
      'github_connection_retired',
      'github_delivery_identity_conflict',
      'github_installation_scope_invalid',
      'github_permissions_mismatch',
      'github_principal_mismatch',
      'github_repository_api_access_failed'
    );
  UPDATE github_finding_feedback
  SET publication_status = 'waiting', error_code = NULL, error_detail = NULL
  WHERE publication_status = 'unavailable'
    AND error_code NOT IN (
      'github_api_request_failed',
      'github_app_profile_mismatch',
      'github_connection_credential_invalid',
      'github_connection_credential_undecryptable',
      'github_connection_retired',
      'github_delivery_identity_conflict',
      'github_installation_scope_invalid',
      'github_permissions_mismatch',
      'github_principal_mismatch',
      'github_repository_api_access_failed'
    );
`;
