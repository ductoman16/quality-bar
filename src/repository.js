import { randomUUID } from "node:crypto";

import { createRepositoryCredentialCipher } from "./repository-credential.js";
import { verifyRepositoryRead } from "./repository-git.js";
import {
  fail,
  normalizeRepositoryRegistration,
  RepositoryError,
} from "./repository-validation.js";
import { isUniqueConstraintFailure } from "./sqlite-error.js";

export { RepositoryError };

/**
 * @typedef {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   transaction<Result>(callback: (transaction: {
 *     run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 *   }) => Result): Result
 * }} RepositoryDurableCore
 */

/**
 * @param {RepositoryDurableCore} durableCore
 * @param {{
 *   createId?: () => string,
 *   masterKey: Buffer,
 *   now?: () => number,
 *   verifyRead?: (
 *     normalizedUrl: string,
 *     credential?: {token: string, username: string}
 *   ) => Promise<void>
 * }} options
 */
export function createRepositoryService(
  durableCore,
  {
    createId = randomUUID,
    masterKey,
    now = () => Date.now(),
    verifyRead = verifyRepositoryRead,
  },
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore.transaction !== "function"
  ) {
    throw new TypeError("durableCore must provide reads and transactions");
  }
  if (
    typeof createId !== "function" ||
    typeof now !== "function" ||
    typeof verifyRead !== "function"
  ) {
    throw new TypeError("Repository dependencies must be functions");
  }
  const credentialCipher = createRepositoryCredentialCipher(masterKey);
  try {
    for (const row of durableCore.all(
      `SELECT
         repositories.id,
         repositories.normalized_url,
         repository_credentials.encrypted_credential
       FROM repository_credentials
       JOIN repositories
         ON repositories.id = repository_credentials.repository_id`,
    )) {
      if (!row) {
        throw new TypeError("Repository credential row is unavailable");
      }
      credentialCipher.decrypt(
        {
          id: /** @type {string} */ (row.id),
          url: /** @type {string} */ (row.normalized_url),
        },
        /** @type {string} */ (row.encrypted_credential),
      );
    }
  } catch (error) {
    credentialCipher.destroy();
    throw error;
  }

  return {
    /** @param {unknown} request */
    async register(request) {
      const { credential, url } = normalizeRepositoryRegistration(request);
      await verifyRead(url, credential);
      const id = createId();
      const timestamp = now();
      if (typeof id !== "string" || id.length === 0) {
        throw new TypeError("createId must return a nonempty string");
      }
      if (!Number.isSafeInteger(timestamp)) {
        throw new TypeError("now must return a safe integer timestamp");
      }
      const encryptedCredential = credential
        ? credentialCipher.encrypt({ id, url }, credential)
        : undefined;
      try {
        durableCore.transaction((transaction) => {
          transaction.run(
            "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
            id,
            url,
            timestamp,
            timestamp,
          );
          if (encryptedCredential) {
            transaction.run(
              "INSERT INTO repository_credentials (repository_id, encrypted_credential, created_at) VALUES (?, ?, ?)",
              id,
              encryptedCredential,
              timestamp,
            );
          }
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
    destroy() {
      credentialCipher.destroy();
    },
  };
}

/** @param {unknown} error */
export function createUnavailableRepositoryService(error) {
  return {
    async register() {
      throw error;
    },
    destroy() {},
  };
}
