import { claimForgejoPollingGeneration } from "./forgejo-polling.js";
import { claimGitHubPollingGeneration } from "./github-polling-generation.js";
import { fail } from "./repository-validation.js";

/**
 * @typedef {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   transaction<Result>(callback: (transaction: {
 *     all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *     run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 *   }) => Result): Result
 * }} RepositoryRemovalCore
 */

/**
 * @param {RepositoryRemovalCore} durableCore
 * @param {string} id
 */
export function removeNeverUsedRepository(durableCore, id) {
  const [repository] = durableCore.all(
    `SELECT lifecycle, lifecycle_revision, has_been_used
     FROM repositories WHERE id = ?`,
    id,
  );
  if (!repository) {
    fail("repository_not_found", "Repository was not found");
  }
  if (repository.has_been_used !== 0 || repository.lifecycle === "retired") {
    fail(
      "repository_delete_unsupported",
      "A referenced Repository must be retired",
    );
  }
  durableCore.transaction((transaction) => {
    advanceRepositoryPollingGenerations(transaction, id);
    transaction.run(
      `DELETE FROM github_repository_polls
       WHERE (connection_id, forge_repository_id) IN (
         SELECT connection_id, forge_repository_id
         FROM github_repositories WHERE repository_id = ?
       )`,
      id,
    );
    transaction.run(
      `DELETE FROM forgejo_repository_polls
       WHERE (connection_id, forge_repository_id) IN (
         SELECT connection_id, forge_repository_id
         FROM forgejo_repositories WHERE repository_id = ?
       )`,
      id,
    );
    transaction.run(
      "DELETE FROM github_repositories WHERE repository_id = ?",
      id,
    );
    transaction.run(
      "DELETE FROM forgejo_repositories WHERE repository_id = ?",
      id,
    );
    transaction.run(
      "DELETE FROM repository_credentials WHERE repository_id = ?",
      id,
    );
    const removed = transaction.run(
      `DELETE FROM repositories
       WHERE id = ? AND has_been_used = 0
         AND lifecycle = ? AND lifecycle_revision = ?`,
      id,
      repository.lifecycle,
      repository.lifecycle_revision,
    );
    if (removed.changes !== 1) {
      fail(
        "repository_lifecycle_conflict",
        "Repository changed during deletion",
      );
    }
  });
}

/**
 * @param {RepositoryRemovalCore} durableCore
 * @param {string} id
 * @param {{lifecycle: string, lifecycleRevision: number}} expected
 */
export function retireUsedRepository(durableCore, id, expected) {
  const [repository] = durableCore.all(
    "SELECT lifecycle, has_been_used FROM repositories WHERE id = ?",
    id,
  );
  if (!repository) {
    fail("repository_not_found", "Repository was not found");
  }
  if (repository.lifecycle === "retired") {
    return;
  }
  if (repository.has_been_used !== 1) {
    fail(
      "repository_retirement_unsupported",
      "A never-used Repository must be deleted",
    );
  }
  durableCore.transaction((transaction) => {
    advanceRepositoryPollingGenerations(transaction, id);
    transaction.run(
      "DELETE FROM repository_credentials WHERE repository_id = ?",
      id,
    );
    const retired = transaction.run(
      `UPDATE repositories
       SET lifecycle = 'retired',
           lifecycle_revision = lifecycle_revision + 1
       WHERE id = ? AND lifecycle = ? AND lifecycle_revision = ?
         AND has_been_used = 1`,
      id,
      expected.lifecycle,
      expected.lifecycleRevision,
    );
    if (retired.changes !== 1) {
      fail(
        "repository_lifecycle_conflict",
        "Repository changed during retirement",
      );
    }
  });
}

/** @param {any} transaction @param {string} repositoryId */
function advanceRepositoryPollingGenerations(transaction, repositoryId) {
  for (const row of transaction.all(
    "SELECT DISTINCT connection_id FROM github_repositories WHERE repository_id = ?",
    repositoryId,
  )) {
    claimGitHubPollingGeneration(transaction, row.connection_id, undefined);
  }
  for (const row of transaction.all(
    "SELECT DISTINCT connection_id FROM forgejo_repositories WHERE repository_id = ?",
    repositoryId,
  )) {
    claimForgejoPollingGeneration(transaction, row.connection_id, undefined);
  }
}
