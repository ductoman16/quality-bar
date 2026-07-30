export const WAIVER_REQUEST_LIFECYCLE_MIGRATION_VALIDATION = `
  CREATE TEMP TABLE quality_bar_waiver_lifecycle_validation (
    invalid INTEGER NOT NULL
  ) STRICT;
  CREATE TEMP TRIGGER quality_bar_waiver_lifecycle_validation_insert
    BEFORE INSERT ON quality_bar_waiver_lifecycle_validation
    BEGIN
      SELECT RAISE(ABORT, 'waiver_request_lifecycle_history_invalid');
    END;
  INSERT INTO quality_bar_waiver_lifecycle_validation (invalid)
  SELECT 1
  WHERE
    EXISTS (
      SELECT finding_id
      FROM waiver_requests
      GROUP BY finding_id
      HAVING count(*) > 3
    )
    OR EXISTS (
      SELECT 1
      FROM waiver_requests AS later_request
      JOIN waiver_requests AS prior_request
        ON prior_request.finding_id = later_request.finding_id
       AND prior_request.rowid < later_request.rowid
       AND trim(prior_request.rationale) = trim(later_request.rationale)
    )
    OR EXISTS (
      SELECT 1
      FROM waiver_requests AS later_request
      WHERE EXISTS (
        SELECT 1 FROM waiver_requests
        WHERE finding_id = later_request.finding_id
          AND rowid < later_request.rowid
      )
      AND COALESCE(
        (
          SELECT waiver_decisions.outcome
          FROM waiver_decisions
          JOIN waiver_adjudications
            ON waiver_adjudications.id =
                 waiver_decisions.waiver_adjudication_id
          WHERE waiver_decisions.waiver_request_id = (
            SELECT prior_request.id
            FROM waiver_requests AS prior_request
            WHERE prior_request.finding_id = later_request.finding_id
              AND prior_request.rowid < later_request.rowid
            ORDER BY prior_request.rowid DESC
            LIMIT 1
          )
          ORDER BY waiver_adjudications.rowid DESC
          LIMIT 1
        ),
        ''
      ) <> 'denied'
    )
    OR EXISTS (
      SELECT 1
      FROM waiver_adjudication_requests AS later_association
      WHERE EXISTS (
        SELECT 1
        FROM waiver_adjudication_requests AS prior_association
        WHERE prior_association.waiver_request_id =
                later_association.waiver_request_id
          AND prior_association.rowid < later_association.rowid
      )
      AND NOT COALESCE((
        (
          SELECT waiver_decisions.outcome
          FROM waiver_adjudication_requests AS prior_association
          JOIN waiver_adjudications
            ON waiver_adjudications.id =
                 prior_association.waiver_adjudication_id
          LEFT JOIN waiver_decisions
            ON waiver_decisions.waiver_adjudication_id =
                 prior_association.waiver_adjudication_id
           AND waiver_decisions.waiver_request_id =
                 prior_association.waiver_request_id
          WHERE prior_association.waiver_request_id =
                  later_association.waiver_request_id
            AND prior_association.rowid < later_association.rowid
          ORDER BY waiver_adjudications.rowid DESC
          LIMIT 1
        ) = 'error'
        OR
        (
          SELECT
            waiver_decisions.id IS NULL
            AND waiver_adjudications.execution_status IN ('failed', 'cancelled')
          FROM waiver_adjudication_requests AS prior_association
          JOIN waiver_adjudications
            ON waiver_adjudications.id =
                 prior_association.waiver_adjudication_id
          LEFT JOIN waiver_decisions
            ON waiver_decisions.waiver_adjudication_id =
                 prior_association.waiver_adjudication_id
           AND waiver_decisions.waiver_request_id =
                 prior_association.waiver_request_id
          WHERE prior_association.waiver_request_id =
                  later_association.waiver_request_id
            AND prior_association.rowid < later_association.rowid
          ORDER BY waiver_adjudications.rowid DESC
          LIMIT 1
        )
      ), 0)
    );
  DROP TRIGGER quality_bar_waiver_lifecycle_validation_insert;
  DROP TABLE quality_bar_waiver_lifecycle_validation;
`;
