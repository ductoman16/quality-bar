import { randomUUID } from "node:crypto";

import { CHECKOUTS_PATH } from "./installation-environment.js";
import { createRepositoryCollection } from "./repository-collection.js";
import { createRepositoryCredentialCipher } from "./repository-credential.js";
import {
  resolvePushedCommitSelectors,
  verifyRepositoryRead,
} from "./repository-git.js";
import {
  readRepositoryResource,
  REPOSITORY_SELECTION,
} from "./repository-resource.js";
import {
  assertRepositoryAcceptsNewWork,
  fail,
  normalizeRepositoryCredentialRotation,
  normalizeRepositoryLifecycleChange,
  normalizePublicRepositoryUrl,
  normalizeRepositoryRegistration,
  RepositoryError,
} from "./repository-validation.js";
import { isUniqueConstraintFailure } from "./sqlite-error.js";
import { createRepositorySelectorResolver } from "./repository-selector.js";

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
 *   objectDatabaseRoot?: string,
 *   verifyRead?: (
 *     normalizedUrl: string,
 *     credential?: {token: string, username: string}
 *   ) => Promise<void>
 *   verifyForgeRepository?: (forgeRepositoryId: number, provider: "github" | "forgejo") => Promise<{commit?: (transaction: any) => void} | void>
 *   resolveSelectors?: typeof resolvePushedCommitSelectors
 * }} options
 */
export function createRepositoryService(
  durableCore,
  {
    createId = randomUUID,
    masterKey,
    now = () => Date.now(),
    objectDatabaseRoot = CHECKOUTS_PATH,
    verifyRead = verifyRepositoryRead,
    verifyForgeRepository,
    resolveSelectors = resolvePushedCommitSelectors,
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
    typeof objectDatabaseRoot !== "string" ||
    objectDatabaseRoot.length === 0 ||
    typeof verifyRead !== "function" ||
    typeof resolveSelectors !== "function"
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

  /** @param {string} id */
  function find(id) {
    if (typeof id !== "string" || id.length === 0) {
      fail("repository_not_found", "Repository was not found");
    }
    const [row] = durableCore.all(
      `${REPOSITORY_SELECTION} WHERE repositories.id = ?`,
      id,
    );
    if (!row) {
      fail("repository_not_found", "Repository was not found");
    }
    return row;
  }

  /** @param {string} id */
  function requireAcceptsNewWork(id) {
    const row = find(id);
    const repository = readRepositoryResource(row);
    if (
      "forge_repository_id" in repository &&
      row.forge_connection_health === "error"
    ) {
      if (
        typeof row.forge_connection_health_error_code !== "string" ||
        typeof row.forge_connection_health_error_message !== "string"
      ) {
        throw new TypeError("Forge Connection health error is invalid");
      }
      fail(
        row.forge_connection_health_error_code,
        row.forge_connection_health_error_message,
      );
    }
    assertRepositoryAcceptsNewWork({
      health: repository.health,
      healthError: repository.health_error,
      lifecycle: repository.lifecycle,
    });
    return repository;
  }

  const repositoryCollection = createRepositoryCollection(
    masterKey,
    ({ after, limit }) => {
      const afterClause = after
        ? `WHERE repositories.normalized_url > ?
             OR (
               repositories.normalized_url = ?
               AND repositories.id > ?
             )`
        : "";
      const parameters = after
        ? [after.url, after.url, after.id, limit]
        : [limit];
      return durableCore
        .all(
          `${REPOSITORY_SELECTION}
           ${afterClause}
           ORDER BY repositories.normalized_url, repositories.id
           LIMIT ?`,
          ...parameters,
        )
        .map(readRepositoryResource);
    },
  );
  const resolvePushedSelectors = createRepositorySelectorResolver({
    credentialCipher,
    find,
    objectDatabaseRoot,
    requireAcceptsNewWork,
    resolveSelectors,
  });

  return {
    list() {
      return durableCore
        .all(
          `${REPOSITORY_SELECTION}
           ORDER BY repositories.normalized_url, repositories.id`,
        )
        .map(readRepositoryResource);
    },
    /** @param {{cursor?: string, limit?: string, remoteUrl?: string}} [query] */
    listPage({ cursor, limit, remoteUrl } = {}) {
      if (remoteUrl === undefined) {
        return repositoryCollection.read({ cursor, limit });
      }
      const normalizedUrl = normalizePublicRepositoryUrl({ url: remoteUrl });
      const exactCollection = createRepositoryCollection(
        masterKey,
        ({ after, limit: pageLimit }) => {
          const afterClause = after
            ? `AND (
                 repositories.normalized_url > ?
                 OR (
                   repositories.normalized_url = ?
                   AND repositories.id > ?
                 )
               )`
            : "";
          const parameters = after
            ? [normalizedUrl, after.url, after.url, after.id, pageLimit]
            : [normalizedUrl, pageLimit];
          return durableCore
            .all(
              `${REPOSITORY_SELECTION}
               WHERE repositories.normalized_url = ?
               ${afterClause}
               ORDER BY repositories.normalized_url, repositories.id
               LIMIT ?`,
              ...parameters,
            )
            .map(readRepositoryResource);
        },
      );
      try {
        return exactCollection.read({ cursor, limit });
      } finally {
        exactCollection.destroy();
      }
    },
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
      return readRepositoryResource(find(id));
    },
    /**
     * @param {string} id
     * @param {unknown} request
     */
    async rotateCredential(id, request) {
      const credential = normalizeRepositoryCredentialRotation(request);
      const row = find(id);
      if (typeof row.encrypted_credential !== "string") {
        fail(
          "repository_credential_not_found",
          "Repository has no credential to rotate",
        );
      }
      const url = /** @type {string} */ (row.normalized_url);
      await verifyRead(url, credential);
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp)) {
        throw new TypeError("now must return a safe integer timestamp");
      }
      const encryptedCredential = credentialCipher.encrypt(
        { id, url },
        credential,
      );
      durableCore.transaction((transaction) => {
        const replacement = transaction.run(
          `UPDATE repository_credentials
           SET encrypted_credential = ?, created_at = ?
           WHERE repository_id = ? AND encrypted_credential = ?`,
          encryptedCredential,
          timestamp,
          id,
          row.encrypted_credential,
        );
        if (replacement.changes !== 1) {
          fail(
            "repository_credential_rotation_conflict",
            "Repository credential changed during rotation",
          );
        }
        transaction.run(
          `UPDATE repositories
           SET verified_at = ?,
               health = 'healthy',
               health_error_code = NULL,
               health_error_message = NULL
           WHERE id = ?`,
          timestamp,
          id,
        );
      });
      return readRepositoryResource(find(id));
    },
    requireAcceptsNewWork,
    resolvePushedSelectors,
    /**
     * @param {string} id
     * @param {unknown} request
     */
    async setLifecycle(id, request) {
      const { lifecycle } = normalizeRepositoryLifecycleChange(request);
      const row = find(id);
      const repository = readRepositoryResource(row);
      if (repository.lifecycle === "retired") {
        fail(
          "repository_retired",
          "Repository retirement must be reversed through reactivation",
        );
      }
      if (lifecycle === "disabled") {
        durableCore.transaction((transaction) => {
          transaction.run(
            "UPDATE repositories SET lifecycle = 'disabled' WHERE id = ?",
            id,
          );
        });
        return readRepositoryResource(find(id));
      }

      const credential =
        typeof row.encrypted_credential === "string"
          ? credentialCipher.decrypt(
              { id: repository.id, url: repository.url },
              row.encrypted_credential,
            )
          : undefined;
      /** @type {{commit?: (transaction: any) => void} | void} */
      let preparedEnablement;
      try {
        if ("forge_repository_id" in repository) {
          if (typeof verifyForgeRepository !== "function") {
            throw new TypeError(
              "Forge Repository verification dependency is unavailable",
            );
          }
          preparedEnablement = await verifyForgeRepository(
            repository.forge_repository_id,
            repository.provider,
          );
        } else {
          await verifyRead(repository.url, credential);
        }
      } catch (error) {
        if (error instanceof RepositoryError) {
          durableCore.transaction((transaction) => {
            transaction.run(
              `UPDATE repositories
               SET health = 'error',
                   health_error_code = ?,
                   health_error_message = ?
               WHERE id = ?`,
              error.code,
              error.message,
              id,
            );
          });
        }
        throw error;
      }
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp)) {
        throw new TypeError("now must return a safe integer timestamp");
      }
      durableCore.transaction((transaction) => {
        preparedEnablement?.commit?.(transaction);
        transaction.run(
          `UPDATE repositories
           SET lifecycle = 'enabled',
               health = 'healthy',
               health_error_code = NULL,
               health_error_message = NULL,
               verified_at = ?
           WHERE id = ?`,
          timestamp,
          id,
        );
      });
      return readRepositoryResource(find(id));
    },
    destroy() {
      repositoryCollection.destroy();
      credentialCipher.destroy();
    },
  };
}

/** @param {unknown} error */
export function createUnavailableRepositoryService(error) {
  return {
    list() {
      throw error;
    },
    listPage() {
      throw error;
    },
    async register() {
      throw error;
    },
    async rotateCredential() {
      throw error;
    },
    requireAcceptsNewWork() {
      throw error;
    },
    async resolvePushedSelectors() {
      throw error;
    },
    async setLifecycle() {
      throw error;
    },
    destroy() {},
  };
}
