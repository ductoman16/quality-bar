/**
 * @param {import("node:sqlite").DatabaseSync} database
 */
export function reviewRunResultColumnMigration(database) {
  const columns = new Set(
    database
      .prepare("PRAGMA table_info(review_runs)")
      .all()
      .map((column) => column.name),
  );
  return `
    ${columns.has("started_at") ? "" : "ALTER TABLE review_runs ADD COLUMN started_at INTEGER;"}
    ${columns.has("completed_at") ? "" : "ALTER TABLE review_runs ADD COLUMN completed_at INTEGER;"}
  `;
}
