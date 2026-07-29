import { isValidFileChange } from "./file-change.js";

/**
 * @param {{run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): unknown}} transaction
 * @param {string} evaluationId
 * @param {any[]} fileChanges
 */
export function insertEvaluationFileChanges(
  transaction,
  evaluationId,
  fileChanges,
) {
  if (
    new Set(fileChanges.map(({ id }) => id)).size !== fileChanges.length ||
    !fileChanges.every(isValidFileChange)
  ) {
    throw new TypeError("Frozen File Change identity is invalid");
  }
  for (const fileChange of fileChanges) {
    if (typeof fileChange.patch !== "string") {
      throw new TypeError("Frozen File Change patch is invalid");
    }
    transaction.run(
      `INSERT INTO evaluation_file_changes (
         evaluation_id, id, added, deleted, modified, renamed,
         before_path, after_path, base_line_count, head_line_count, patch
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      evaluationId,
      fileChange.id,
      Number(fileChange.added),
      Number(fileChange.deleted),
      Number(fileChange.modified),
      Number(fileChange.renamed),
      fileChange.before_path,
      fileChange.after_path,
      fileChange.base_line_count,
      fileChange.head_line_count,
      fileChange.patch,
    );
  }
}
