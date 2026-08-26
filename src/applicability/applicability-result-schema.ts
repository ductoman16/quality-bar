export const APPLICABILITY_RESULT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS applicability_selections (
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    review_id TEXT NOT NULL REFERENCES reviews(id),
    review_version_id TEXT NOT NULL REFERENCES review_versions(id),
    assignment_scope TEXT NOT NULL
      CHECK (assignment_scope IN ('installation_wide', 'repository_specific')),
    profile TEXT,
    rule_source TEXT,
    PRIMARY KEY (evaluation_id, review_id),
    UNIQUE (
      evaluation_id,
      review_id,
      review_version_id,
      assignment_scope
    ),
    UNIQUE (evaluation_id, review_id, rule_source),
    UNIQUE (evaluation_id, review_id, rule_source, profile),
    FOREIGN KEY (
      review_version_id,
      review_id
    ) REFERENCES review_versions (id, review_id),
    CHECK (
      (rule_source IS NULL AND profile IS NULL)
      OR
      (
        rule_source IS NOT NULL
        AND profile IS 'quality-bar-restricted-cel-v1'
      )
    )
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS applicability_selection_rule_insert
    BEFORE INSERT ON applicability_selections
    WHEN EXISTS (
      SELECT 1
      FROM review_versions
      WHERE id = NEW.review_version_id
        AND review_id = NEW.review_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM review_versions
      WHERE id = NEW.review_version_id
        AND review_id = NEW.review_id
        AND applicability_rule IS NEW.rule_source
    )
    BEGIN
      SELECT RAISE(ABORT, 'applicability_selection_rule_mismatch');
    END;
  CREATE TRIGGER IF NOT EXISTS applicability_selection_immutable_update
    BEFORE UPDATE ON applicability_selections
    BEGIN SELECT RAISE(ABORT, 'applicability_selection_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS applicability_selection_immutable_delete
    BEFORE DELETE ON applicability_selections
    BEGIN SELECT RAISE(ABORT, 'applicability_selection_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS applicability_selection_closed_insert
    BEFORE INSERT ON applicability_selections
    WHEN (
      SELECT applicability_sealed_at IS NOT NULL
      FROM evaluations
      WHERE id = NEW.evaluation_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'applicability_result_insertion_closed');
    END;
  CREATE TABLE IF NOT EXISTS applicability_results (
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    review_id TEXT NOT NULL REFERENCES reviews(id),
    review_version_id TEXT NOT NULL REFERENCES review_versions(id),
    assignment_scope TEXT NOT NULL
      CHECK (assignment_scope IN ('installation_wide', 'repository_specific')),
    profile TEXT,
    rule_source TEXT,
    outcome TEXT NOT NULL
      CHECK (outcome IN ('applicable', 'not_applicable', 'error')),
    evidence_json TEXT,
    error_code TEXT,
    error_detail TEXT,
    error_context_json TEXT,
    PRIMARY KEY (evaluation_id, review_id),
    FOREIGN KEY (
      evaluation_id,
      review_id,
      review_version_id,
      assignment_scope
    ) REFERENCES applicability_selections (
      evaluation_id,
      review_id,
      review_version_id,
      assignment_scope
    ),
    FOREIGN KEY (
      evaluation_id,
      review_id,
      rule_source,
      profile
    ) REFERENCES applicability_selections (
      evaluation_id,
      review_id,
      rule_source,
      profile
    ),
    CHECK (
      (rule_source IS NULL AND profile IS NULL)
      OR
      (
        rule_source IS NOT NULL
        AND profile IS 'quality-bar-restricted-cel-v1'
      )
    ),
    CHECK (
      evidence_json IS NULL
      OR CASE
        WHEN json_valid(evidence_json) THEN
          json_type(evidence_json) = 'object'
          AND json_type(evidence_json, '$.kind') = 'text'
          AND json_extract(evidence_json, '$.kind') IN (
            'unconditional',
            'failed_branches',
            'satisfied_branches',
            'matched'
          )
        ELSE 0
      END
    ),
    CHECK (
      error_context_json IS NULL
      OR CASE
        WHEN json_valid(error_context_json) THEN
          json_type(error_context_json) = 'object'
          AND json_type(error_context_json, '$.code') = 'text'
          AND json_extract(error_context_json, '$.code') = error_code
          AND json_type(error_context_json, '$.detail') = 'text'
          AND json_extract(error_context_json, '$.detail') = error_detail
          AND (
            json_type(error_context_json, '$.file_change_id') IS NULL
            OR (
              json_type(error_context_json, '$.file_change_id') = 'text'
              AND length(json_extract(
                error_context_json,
                '$.file_change_id'
              )) > 0
            )
          )
          AND (
            json_type(error_context_json, '$.predicate_id') IS NULL
            OR (
              json_type(error_context_json, '$.predicate_id') = 'text'
              AND printf(
                'predicate-%d',
                CAST(substr(
                  json_extract(error_context_json, '$.predicate_id'),
                  11
                ) AS INTEGER)
              ) = json_extract(error_context_json, '$.predicate_id')
              AND CAST(substr(
                json_extract(error_context_json, '$.predicate_id'),
                11
              ) AS INTEGER) > 0
            )
          )
          AND (
            json_type(error_context_json, '$.side') IS NULL
            OR json_extract(error_context_json, '$.side') IN ('before', 'after')
          )
          AND json_remove(
            error_context_json,
            '$.code',
            '$.detail',
            '$.file_change_id',
            '$.predicate_id',
            '$.side'
          ) = '{}'
        ELSE 0
      END
    ),
    CHECK (
      (outcome = 'error'
        AND evidence_json IS NULL
        AND error_code IS NOT NULL AND length(error_code) > 0
        AND error_code NOT GLOB '*[^a-z0-9_]*'
        AND substr(error_code, 1, 1) GLOB '[a-z]'
        AND error_detail IS NOT NULL AND length(trim(error_detail)) > 0
        AND error_context_json IS NOT NULL)
      OR
      (outcome <> 'error'
        AND evidence_json IS NOT NULL
        AND error_code IS NULL AND error_detail IS NULL
        AND error_context_json IS NULL)
    )
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS applicability_result_unconditional_insert
    BEFORE INSERT ON applicability_results
    WHEN NEW.rule_source IS NULL
      AND CASE
        WHEN json_valid(NEW.evidence_json) THEN NOT (
          NEW.outcome = 'applicable'
          AND json_type(NEW.evidence_json) = 'object'
          AND json_extract(NEW.evidence_json, '$.kind') = 'unconditional'
          AND json_remove(NEW.evidence_json, '$.kind') = '{}'
        )
        ELSE 1
      END
    BEGIN
      SELECT RAISE(ABORT, 'applicability_result_evidence_invalid');
    END;
  CREATE TRIGGER IF NOT EXISTS applicability_result_closed_insert
    BEFORE INSERT ON applicability_results
    WHEN (
      SELECT applicability_sealed_at IS NOT NULL
      FROM evaluations
      WHERE id = NEW.evaluation_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'applicability_result_insertion_closed');
    END;
  CREATE TRIGGER IF NOT EXISTS applicability_result_ruled_evidence_insert
    BEFORE INSERT ON applicability_results
    WHEN NEW.rule_source IS NOT NULL
      AND NEW.outcome <> 'error'
      AND CASE
        WHEN json_valid(NEW.evidence_json) THEN NOT (
          (
            json_extract(NEW.evidence_json, '$.kind') IN (
              'failed_branches',
              'satisfied_branches'
            )
            AND (
              (
                NEW.outcome = 'not_applicable'
                AND json_extract(
                  NEW.evidence_json,
                  '$.kind'
                ) = 'failed_branches'
              )
              OR
              (
                NEW.outcome = 'applicable'
                AND json_extract(
                  NEW.evidence_json,
                  '$.kind'
                ) = 'satisfied_branches'
              )
            )
            AND json_remove(
              NEW.evidence_json,
              '$.kind',
              '$.branch_ids',
              '$.predicate_ids'
            ) = '{}'
            AND json_type(NEW.evidence_json, '$.branch_ids') = 'array'
            AND json_type(NEW.evidence_json, '$.predicate_ids') = 'array'
            AND NOT EXISTS (
              SELECT 1
              FROM json_each(NEW.evidence_json, '$.branch_ids')
              WHERE type <> 'text'
                 OR printf('branch-%d', CAST(substr(value, 8) AS INTEGER))
                    <> value
                 OR CAST(substr(value, 8) AS INTEGER) < 1
            )
            AND NOT EXISTS (
              SELECT 1
              FROM json_each(NEW.evidence_json, '$.predicate_ids')
              WHERE type <> 'text'
                 OR printf('predicate-%d', CAST(substr(value, 11) AS INTEGER))
                    <> value
                 OR CAST(substr(value, 11) AS INTEGER) < 1
            )
            AND (
              json_extract(NEW.evidence_json, '$.kind') = 'failed_branches'
              OR json_array_length(
                NEW.evidence_json,
                '$.predicate_ids'
              ) > 0
            )
          )
          OR
          (
            NEW.outcome = 'applicable'
            AND
            json_extract(NEW.evidence_json, '$.kind') = 'matched'
            AND json_remove(
              NEW.evidence_json,
              '$.kind',
              '$.matches'
            ) = '{}'
            AND json_type(NEW.evidence_json, '$.matches') = 'array'
            AND json_array_length(NEW.evidence_json, '$.matches') > 0
            AND NOT EXISTS (
              SELECT 1
              FROM json_each(NEW.evidence_json, '$.matches') AS matched
              WHERE json_type(matched.value) <> 'object'
                 OR json_remove(
                      matched.value,
                      '$.file_change_id',
                      '$.before_path',
                      '$.after_path',
                      '$.branch_ids',
                      '$.predicate_ids',
                      '$.sides'
                    ) <> '{}'
                 OR json_type(matched.value, '$.file_change_id') <> 'text'
                 OR length(json_extract(
                      matched.value,
                      '$.file_change_id'
                    )) = 0
                 OR coalesce(
                      json_type(matched.value, '$.before_path'),
                      'missing'
                    ) NOT IN ('text', 'null')
                 OR coalesce(
                      json_type(matched.value, '$.after_path'),
                      'missing'
                    ) NOT IN ('text', 'null')
                 OR json_type(matched.value, '$.branch_ids') <> 'array'
                 OR json_array_length(matched.value, '$.branch_ids') = 0
                 OR EXISTS (
                      SELECT 1
                      FROM json_each(
                        matched.value,
                        '$.branch_ids'
                      ) AS branch
                      WHERE branch.type <> 'text'
                         OR printf(
                              'branch-%d',
                              CAST(substr(branch.value, 8) AS INTEGER)
                            ) <> branch.value
                         OR CAST(substr(branch.value, 8) AS INTEGER) < 1
                    )
                 OR json_type(matched.value, '$.predicate_ids') <> 'array'
                 OR json_array_length(matched.value, '$.predicate_ids') = 0
                 OR EXISTS (
                      SELECT 1
                      FROM json_each(
                        matched.value,
                        '$.predicate_ids'
                      ) AS predicate
                      WHERE predicate.type <> 'text'
                         OR printf(
                              'predicate-%d',
                              CAST(substr(predicate.value, 11) AS INTEGER)
                            ) <> predicate.value
                         OR CAST(substr(predicate.value, 11) AS INTEGER) < 1
                    )
                 OR json_type(matched.value, '$.sides') <> 'array'
                 OR json_array_length(matched.value, '$.sides') = 0
                 OR EXISTS (
                      SELECT 1
                      FROM json_each(matched.value, '$.sides') AS side
                      WHERE side.type <> 'text'
                         OR side.value NOT IN ('change', 'before', 'after')
                    )
            )
          )
        )
        ELSE 1
      END
    BEGIN
      SELECT RAISE(ABORT, 'applicability_result_evidence_invalid');
    END;
  CREATE TRIGGER IF NOT EXISTS applicability_result_error_insert
    BEFORE INSERT ON applicability_results
    WHEN NEW.outcome = 'error'
      AND CASE
        WHEN json_valid(NEW.error_context_json) THEN NOT (
          NEW.evidence_json IS NULL
          AND json_type(NEW.error_context_json) = 'object'
          AND json_extract(NEW.error_context_json, '$.code') = NEW.error_code
          AND json_extract(NEW.error_context_json, '$.detail') =
            NEW.error_detail
        )
        ELSE 1
      END
    BEGIN
      SELECT RAISE(ABORT, 'applicability_result_error_invalid');
    END;
  CREATE TRIGGER IF NOT EXISTS applicability_result_immutable_update
    BEFORE UPDATE ON applicability_results
    BEGIN SELECT RAISE(ABORT, 'applicability_result_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS applicability_result_immutable_delete
    BEFORE DELETE ON applicability_results
    BEGIN SELECT RAISE(ABORT, 'applicability_result_immutable'); END;
`;
