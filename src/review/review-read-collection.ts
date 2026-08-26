import { readReview } from "./review-read.ts";

export type ReviewTransaction = {
  get(
    sql: string,
    ...parameters: import("node:sqlite").SQLInputValue[]
  ): Record<string, import("node:sqlite").SQLInputValue> | undefined;
  all(
    sql: string,
    ...parameters: import("node:sqlite").SQLInputValue[]
  ): Array<Record<string, import("node:sqlite").SQLInputValue> | undefined>;
  run(
    sql: string,
    ...parameters: import("node:sqlite").SQLInputValue[]
  ): import("node:sqlite").StatementResultingChanges;
};

export function readReviewCollection(
  transaction: ReviewTransaction,
  query: string,
  invalidCode: string,
  ...parameters: Array<import("node:sqlite").SQLInputValue>
) {
  return transaction.all(query, ...parameters).map((row) => {
    if (!row || typeof row.id !== "string") {
      throw new Error(invalidCode);
    }
    return readReview(transaction, row.id);
  });
}
