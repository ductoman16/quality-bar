import { randomUUID } from "node:crypto";

import { verifyPublicRepositoryRead } from "./repository-git.js";
import {
  fail,
  normalizePublicRepositoryUrl,
  RepositoryError,
} from "./repository-validation.js";
import { isUniqueConstraintFailure } from "./sqlite-error.js";

export { RepositoryError };

/**
 * @typedef {{
 *   transaction<Result>(callback: (transaction: {
 *     run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 *   }) => Result): Result
 * }} RepositoryDurableCore
 */

/**
 * @param {RepositoryDurableCore} durableCore
 * @param {{
 *   createId?: () => string,
 *   now?: () => number,
 *   verifyRead?: (normalizedUrl: string) => Promise<void>
 * }} [options]
 */
export function createRepositoryService(
  durableCore,
  {
    createId = randomUUID,
    now = () => Date.now(),
    verifyRead = verifyPublicRepositoryRead,
  } = {},
) {
  if (typeof durableCore?.transaction !== "function") {
    throw new TypeError("durableCore must provide transactions");
  }
  if (
    typeof createId !== "function" ||
    typeof now !== "function" ||
    typeof verifyRead !== "function"
  ) {
    throw new TypeError("Repository dependencies must be functions");
  }

  return {
    /** @param {unknown} request */
    async registerPublic(request) {
      const url = normalizePublicRepositoryUrl(request);
      await verifyRead(url);
      const id = createId();
      const timestamp = now();
      if (typeof id !== "string" || id.length === 0) {
        throw new TypeError("createId must return a nonempty string");
      }
      if (!Number.isSafeInteger(timestamp)) {
        throw new TypeError("now must return a safe integer timestamp");
      }
      try {
        durableCore.transaction((transaction) => {
          transaction.run(
            "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
            id,
            url,
            timestamp,
            timestamp,
          );
        });
      } catch (error) {
        if (isUniqueConstraintFailure(error, "repositories.normalized_url")) {
          fail(
            "repository_identity_conflict",
            "Repository identity is already registered",
          );
        }
        throw error;
      }
      return { id, url };
    },
  };
}

/** @param {unknown} error */
export function createUnavailableRepositoryService(error) {
  return {
    async registerPublic() {
      throw error;
    },
  };
}
