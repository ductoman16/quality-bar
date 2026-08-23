import { fail, RepositoryError } from "./repository-validation.js";

/**
 * @typedef {{
 *   transaction<Result>(callback: (transaction: {
 *     run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 *   }) => Result): Result
 * }} RepositoryEnablementCore
 */

/**
 * @param {RepositoryEnablementCore} durableCore
 * @param {{code: string, commit?: (transaction: any) => void, id: string, lifecycle: string, lifecycleRevision: number, message: string}} failure
 */
export function recordRepositoryVerificationFailure(
  durableCore,
  { code, commit, id, lifecycle, lifecycleRevision, message },
) {
  durableCore.transaction((transaction) => {
    commit?.(transaction);
    const failed = transaction.run(
      `UPDATE repositories
       SET health = 'error',
           health_error_code = ?,
           health_error_message = ?
       WHERE id = ? AND lifecycle = ? AND lifecycle_revision = ?`,
      code,
      message,
      id,
      lifecycle,
      lifecycleRevision,
    );
    if (failed.changes !== 1) {
      fail(
        "repository_lifecycle_conflict",
        "Repository changed during verification",
      );
    }
  });
}

/**
 * @param {RepositoryEnablementCore} durableCore
 * @param {unknown} error
 * @param {{id: string, lifecycle: string, lifecycleRevision: number}} repository
 */
export function recordPreparedRepositoryVerificationFailure(
  durableCore,
  error,
  repository,
) {
  if (error instanceof RepositoryError) {
    const cause =
      error.cause && typeof error.cause === "object"
        ? /** @type {{commit?: unknown}} */ (error.cause)
        : null;
    recordRepositoryVerificationFailure(durableCore, {
      code: error.code,
      commit:
        typeof cause?.commit === "function"
          ? /** @type {(transaction: any) => void} */ (cause.commit)
          : undefined,
      id: repository.id,
      lifecycle: repository.lifecycle,
      lifecycleRevision: repository.lifecycleRevision,
      message: error.message,
    });
  } else if (
    error instanceof Error &&
    "commit" in error &&
    typeof error.commit === "function"
  ) {
    durableCore.transaction(
      /** @type {(transaction: any) => void} */ (error.commit),
    );
  }
}

/**
 * @param {RepositoryEnablementCore} durableCore
 * @param {{commit?: (transaction: any) => void} | void} prepared
 * @param {{id: string, lifecycle: string, lifecycleRevision: number, timestamp: number}} repository
 */
export function commitRepositoryEnablement(
  durableCore,
  prepared,
  { id, lifecycle, lifecycleRevision, timestamp },
) {
  durableCore.transaction((transaction) => {
    prepared?.commit?.(transaction);
    const enabled = transaction.run(
      `UPDATE repositories
       SET lifecycle = 'enabled',
           lifecycle_revision = lifecycle_revision + 1,
           health = 'healthy',
           health_error_code = NULL,
           health_error_message = NULL,
           verified_at = ?
       WHERE id = ? AND lifecycle = ? AND lifecycle_revision = ?`,
      timestamp,
      id,
      lifecycle,
      lifecycleRevision,
    );
    if (enabled.changes !== 1) {
      fail(
        "repository_lifecycle_conflict",
        "Repository changed during verification",
      );
    }
  });
}
