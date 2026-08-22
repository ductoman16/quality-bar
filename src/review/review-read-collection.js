import { readReview } from "./review-read.js";

/**
 * @typedef {{
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Array<Record<string, import("node:sqlite").SQLInputValue> | undefined>,
 *   run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 * }} ReviewTransaction
 */

/**
 * @param {ReviewTransaction} transaction
 * @param {string} query
 * @param {string} invalidCode
 * @param {...import("node:sqlite").SQLInputValue} parameters
 */
export function readReviewCollection(
  transaction,
  query,
  invalidCode,
  ...parameters
) {
  return transaction.all(query, ...parameters).map((row) => {
    if (!row || typeof row.id !== "string") {
      throw new Error(invalidCode);
    }
    return readReview(transaction, row.id);
  });
}
