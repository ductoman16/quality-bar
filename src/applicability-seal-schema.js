export const APPLICABILITY_SEAL_SCHEMA = `
  CREATE TRIGGER IF NOT EXISTS evaluation_applicability_seal_insert
    BEFORE INSERT ON evaluations
    WHEN NEW.applicability_sealed_at IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'applicability_result_seal_must_transition'); END;
  CREATE TRIGGER IF NOT EXISTS evaluation_applicability_seal_update
    BEFORE UPDATE OF applicability_sealed_at ON evaluations
    WHEN OLD.applicability_sealed_at IS NOT NULL
      OR NEW.applicability_sealed_at IS NULL
    BEGIN SELECT RAISE(ABORT, 'applicability_result_seal_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS evaluation_applicability_seal_complete_update
    BEFORE UPDATE OF applicability_sealed_at ON evaluations
    WHEN OLD.applicability_sealed_at IS NULL
      AND NEW.applicability_sealed_at IS NOT NULL
      AND EXISTS (
        SELECT 1 WHERE EXISTS (
          SELECT 1
          FROM applicability_selections AS selected
          LEFT JOIN applicability_results AS result
            ON result.evaluation_id = selected.evaluation_id
           AND result.review_id = selected.review_id
          WHERE selected.evaluation_id = NEW.id
            AND result.evaluation_id IS NULL
        )
        OR EXISTS (
          SELECT 1
          FROM reviews
          JOIN review_assignments
            ON review_assignments.review_id = reviews.id
          WHERE reviews.archived_at IS NULL
            AND (
              review_assignments.scope = 'installation_wide'
              OR EXISTS (
                SELECT 1
                FROM review_assignment_repositories
                WHERE review_id = reviews.id
                  AND repository_id = NEW.repository_id
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM applicability_selections AS selected
              WHERE selected.evaluation_id = NEW.id
                AND selected.review_id = reviews.id
                AND selected.review_version_id = reviews.active_version_id
                AND selected.assignment_scope = CASE review_assignments.scope
                  WHEN 'repository_set' THEN 'repository_specific'
                  ELSE review_assignments.scope
                END
            )
        )
        OR EXISTS (
          SELECT 1
          FROM applicability_selections AS selected
          WHERE selected.evaluation_id = NEW.id
            AND NOT EXISTS (
              SELECT 1
              FROM reviews
              JOIN review_assignments
                ON review_assignments.review_id = reviews.id
              WHERE reviews.id = selected.review_id
                AND reviews.active_version_id = selected.review_version_id
                AND reviews.archived_at IS NULL
                AND selected.assignment_scope = CASE review_assignments.scope
                  WHEN 'repository_set' THEN 'repository_specific'
                  ELSE review_assignments.scope
                END
                AND (
                  review_assignments.scope = 'installation_wide'
                  OR EXISTS (
                    SELECT 1
                    FROM review_assignment_repositories
                    WHERE review_id = reviews.id
                      AND repository_id = NEW.repository_id
                  )
                )
            )
        )
      )
    BEGIN SELECT RAISE(ABORT, 'applicability_result_set_incomplete'); END;
`;
