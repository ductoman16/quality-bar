import { isValidFileChange } from "./file-change.js";

/** @param {Record<string, any>} fileChange */
function canonicalFileChange(fileChange) {
  return {
    added: Boolean(fileChange.added),
    after_path: fileChange.after_path,
    base_line_count: fileChange.base_line_count,
    before_path: fileChange.before_path,
    deleted: Boolean(fileChange.deleted),
    head_line_count: fileChange.head_line_count,
    id: fileChange.id,
    modified: Boolean(fileChange.modified),
    patch: fileChange.patch,
    renamed: Boolean(fileChange.renamed),
  };
}

/** @returns {never} */
function failAuthorityMismatch() {
  throw Object.assign(
    new Error("Frozen File Changes do not match the Evaluation authority"),
    { code: "evaluation_file_change_authority_mismatch" },
  );
}

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *   run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): unknown
 * }} transaction
 * @param {string} evaluationId
 * @param {string} reviewRunId
 * @param {any[]} fileChanges
 */
export function storeEvaluationFileChanges(
  transaction,
  evaluationId,
  reviewRunId,
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
  }
  const storedFileChanges = transaction.all(
    `SELECT id, added, deleted, modified, renamed,
            before_path, after_path, base_line_count, head_line_count, patch
     FROM evaluation_file_changes
     WHERE evaluation_id = ?
     ORDER BY id`,
    evaluationId,
  );
  if (storedFileChanges.length !== 0) {
    const expected = fileChanges
      .map(canonicalFileChange)
      .sort((left, right) => left.id.localeCompare(right.id));
    const actual = storedFileChanges.map((fileChange) =>
      canonicalFileChange(/** @type {Record<string, any>} */ (fileChange)),
    );
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failAuthorityMismatch();
    }
    return;
  }
  const completedSiblingCount = transaction.get(
    `SELECT count(*) AS count FROM review_runs
     WHERE evaluation_id = ? AND id <> ? AND execution_status = 'completed'`,
    evaluationId,
    reviewRunId,
  )?.count;
  if (completedSiblingCount !== 0 && fileChanges.length !== 0) {
    failAuthorityMismatch();
  }
  for (const fileChange of fileChanges) {
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
