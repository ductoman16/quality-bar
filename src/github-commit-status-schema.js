export const GITHUB_COMMIT_STATUS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS github_commit_statuses (
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
    error_code TEXT,
    error_detail TEXT,
    CHECK (
      (publication_status = 'waiting'
        AND published_state IS NULL
        AND published_at IS NULL
        AND error_code IS NULL
        AND error_detail IS NULL)
      OR
      (publication_status = 'succeeded'
        AND published_state = desired_state
        AND published_at IS NOT NULL
        AND error_code IS NULL
        AND error_detail IS NULL)
      OR
      (publication_status = 'unavailable'
        AND published_state IS NULL
        AND published_at IS NULL
        AND error_code IS NOT NULL
        AND length(error_code) > 0
        AND error_detail IS NOT NULL
        AND length(trim(error_detail)) > 0)
    ),
    PRIMARY KEY (repository_id, head_commit)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS github_commit_status_admit
    AFTER INSERT ON evaluations
    WHEN EXISTS (
      SELECT 1 FROM github_repositories
      WHERE repository_id = NEW.repository_id
    )
    BEGIN
      INSERT INTO github_commit_statuses (
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
        error_code = NULL,
        error_detail = NULL
      WHERE
        (SELECT created_at FROM evaluations
          WHERE id = excluded.evaluation_id)
          >
        (SELECT created_at FROM evaluations
          WHERE id = github_commit_statuses.evaluation_id)
        OR (
          (SELECT created_at FROM evaluations
            WHERE id = excluded.evaluation_id)
            =
          (SELECT created_at FROM evaluations
            WHERE id = github_commit_statuses.evaluation_id)
          AND excluded.evaluation_id > github_commit_statuses.evaluation_id
        );
    END;
  CREATE TRIGGER IF NOT EXISTS github_commit_status_complete
    AFTER INSERT ON evaluation_results
    BEGIN
      UPDATE github_commit_statuses
      SET desired_state = CASE NEW.outcome
            WHEN 'clear' THEN 'success'
            WHEN 'advisory' THEN 'failure'
            WHEN 'blocking' THEN 'failure'
            WHEN 'error' THEN 'error'
          END,
          publication_status = CASE
            WHEN EXISTS (
              SELECT 1
              FROM github_repositories
              JOIN github_connections
                ON github_connections.id =
                     github_repositories.connection_id
              WHERE github_repositories.repository_id =
                      github_commit_statuses.repository_id
                AND github_connections.lifecycle = 'retired'
            ) THEN 'unavailable'
            ELSE 'waiting'
          END,
          published_state = NULL,
          published_at = NULL,
          error_code = CASE
            WHEN EXISTS (
              SELECT 1
              FROM github_repositories
              JOIN github_connections
                ON github_connections.id =
                     github_repositories.connection_id
              WHERE github_repositories.repository_id =
                      github_commit_statuses.repository_id
                AND github_connections.lifecycle = 'retired'
            ) THEN 'github_connection_retired'
            ELSE NULL
          END,
          error_detail = CASE
            WHEN EXISTS (
              SELECT 1
              FROM github_repositories
              JOIN github_connections
                ON github_connections.id =
                     github_repositories.connection_id
              WHERE github_repositories.repository_id =
                      github_commit_statuses.repository_id
                AND github_connections.lifecycle = 'retired'
            ) THEN
              'GitHub commit status publication is unavailable because the GitHub Connection is retired'
            ELSE NULL
          END
      WHERE evaluation_id = NEW.evaluation_id;
    END;
  INSERT INTO github_commit_statuses (
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
        'GitHub commit status publication is unavailable because the GitHub Connection is retired'
      ELSE NULL
    END
  FROM evaluations
  JOIN github_repositories
    ON github_repositories.repository_id = evaluations.repository_id
  JOIN github_connections
    ON github_connections.id = github_repositories.connection_id
  LEFT JOIN evaluation_results
    ON evaluation_results.evaluation_id = evaluations.id
  WHERE true
  ORDER BY evaluations.created_at DESC, evaluations.id DESC
  ON CONFLICT (repository_id, head_commit) DO NOTHING;
`;
