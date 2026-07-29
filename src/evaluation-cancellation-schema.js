export const EVALUATION_CANCELLATION_COLUMNS = `
  cancellation_requested_at INTEGER,
  cancellation_code TEXT,
  cancellation_detail TEXT,
`;

export const EVALUATION_CANCELLATION_CHECK = `
  CHECK (
    (execution_status = 'cancelled'
      AND cancellation_requested_at IS NOT NULL
      AND cancellation_requested_at >= created_at
      AND cancellation_code IS NOT NULL
      AND cancellation_code = 'cancelled_by_operator'
      AND cancellation_detail IS NOT NULL
      AND length(trim(cancellation_detail)) > 0)
    OR
    (execution_status <> 'cancelled'
      AND cancellation_requested_at IS NULL
      AND cancellation_code IS NULL
      AND cancellation_detail IS NULL)
  )
`;

export const EVALUATION_CANCELLATION_TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS evaluation_cancellation_insert
    BEFORE INSERT ON evaluations
    WHEN (
      (NEW.execution_status = 'cancelled'
        AND (
          NEW.cancellation_requested_at IS NULL
          OR NEW.cancellation_requested_at < NEW.created_at
          OR NEW.cancellation_code IS NULL
          OR NEW.cancellation_code <> 'cancelled_by_operator'
          OR NEW.cancellation_detail IS NULL
          OR length(trim(NEW.cancellation_detail)) = 0
        ))
      OR
      (NEW.execution_status <> 'cancelled'
        AND (
          NEW.cancellation_requested_at IS NOT NULL
          OR NEW.cancellation_code IS NOT NULL
          OR NEW.cancellation_detail IS NOT NULL
        ))
    )
    BEGIN SELECT RAISE(ABORT, 'evaluation_cancellation_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS evaluation_cancellation_update
    BEFORE UPDATE OF
      execution_status,
      cancellation_requested_at,
      cancellation_code,
      cancellation_detail
    ON evaluations
    WHEN (
      (NEW.execution_status = 'cancelled'
        AND (
          NEW.cancellation_requested_at IS NULL
          OR NEW.cancellation_requested_at < NEW.created_at
          OR NEW.cancellation_code IS NULL
          OR NEW.cancellation_code <> 'cancelled_by_operator'
          OR NEW.cancellation_detail IS NULL
          OR length(trim(NEW.cancellation_detail)) = 0
        ))
      OR
      (NEW.execution_status <> 'cancelled'
        AND (
          NEW.cancellation_requested_at IS NOT NULL
          OR NEW.cancellation_code IS NOT NULL
          OR NEW.cancellation_detail IS NOT NULL
        ))
    )
    BEGIN SELECT RAISE(ABORT, 'evaluation_cancellation_invalid'); END;
`;

/** @param {import("node:sqlite").DatabaseSync} database */
export function evaluationCancellationMigration(database) {
  const columns = new Set(
    database
      .prepare("PRAGMA table_info(evaluations)")
      .all()
      .map((column) => column.name),
  );
  if (columns.size === 0) {
    return "";
  }
  const cancellationColumns = [
    "cancellation_requested_at",
    "cancellation_code",
    "cancellation_detail",
  ];
  const existingCancellationColumnCount = cancellationColumns.filter((column) =>
    columns.has(column),
  ).length;
  if (
    existingCancellationColumnCount !== 0 &&
    existingCancellationColumnCount !== cancellationColumns.length
  ) {
    throw new TypeError("Evaluation cancellation schema is incomplete");
  }
  if (existingCancellationColumnCount === cancellationColumns.length) {
    const invalid = database
      .prepare(
        `SELECT 1 FROM evaluations
         WHERE (
           execution_status = 'cancelled'
           AND (
             cancellation_requested_at IS NULL
             OR cancellation_requested_at < created_at
             OR cancellation_code IS NULL
             OR cancellation_code <> 'cancelled_by_operator'
             OR cancellation_detail IS NULL
             OR length(trim(cancellation_detail)) = 0
           )
         ) OR (
           execution_status <> 'cancelled'
           AND (
             cancellation_requested_at IS NOT NULL
             OR cancellation_code IS NOT NULL
             OR cancellation_detail IS NOT NULL
           )
         )
         LIMIT 1`,
      )
      .get();
    if (invalid) {
      throw new TypeError("Evaluation cancellation facts are invalid");
    }
    return "";
  }
  if (
    database
      .prepare(
        "SELECT 1 FROM evaluations WHERE execution_status = 'cancelled' LIMIT 1",
      )
      .get()
  ) {
    throw new TypeError(
      "Legacy cancelled Evaluation lacks exact cancellation facts",
    );
  }
  return `
    ALTER TABLE evaluations ADD COLUMN cancellation_requested_at INTEGER;
    ALTER TABLE evaluations ADD COLUMN cancellation_code TEXT;
    ALTER TABLE evaluations ADD COLUMN cancellation_detail TEXT;
  `;
}
