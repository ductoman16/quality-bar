import { readRepositoryResource } from "./repository-resource.ts";
import {
  fail,
  normalizeRepositoryRegistration,
  RepositoryError,
} from "./repository-validation.ts";
import { isUniqueConstraintFailure } from "../sqlite-error.ts";

export function createRepositoryRegistration({
  credentialCipher,
  createId,
  durableCore,
  find,
  now,
  registerSecret,
  verifyRead,
}: {
  credentialCipher: ReturnType<
    typeof import("./repository-credential.ts").createRepositoryCredentialCipher
  >;
  createId: () => string;
  durableCore: {
    all(
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[];
    transaction<Result>(
      callback: (transaction: {
        run(
          sql: string,
          ...parameters: import("node:sqlite").SQLInputValue[]
        ): import("node:sqlite").StatementResultingChanges;
      }) => Result,
    ): Result;
  };
  find: (
    id: string,
  ) => Record<string, import("node:sqlite").SQLInputValue> | undefined;
  now: () => number;
  registerSecret?: (secret: string) => unknown;
  verifyRead: (
    url: string,
    credential?: { token: string; username: string },
  ) => Promise<void>;
}) {
  return async function registerRepository(request: unknown) {
    const { credential, url } = normalizeRepositoryRegistration(request);
    if (credential) {
      registerSecret?.(credential.token);
      registerSecret?.(credential.username);
    }
    const [existing] = durableCore.all(
      `SELECT repositories.id, repositories.lifecycle,
              repositories.lifecycle_revision,
              github_repositories.repository_id AS github_repository_id,
              forgejo_repositories.repository_id AS forgejo_repository_id
       FROM repositories
       LEFT JOIN github_repositories
         ON github_repositories.repository_id = repositories.id
       LEFT JOIN forgejo_repositories
         ON forgejo_repositories.repository_id = repositories.id
       WHERE repositories.normalized_url = ?`,
      url,
    );
    if (
      existing &&
      (existing.lifecycle !== "retired" ||
        typeof existing.github_repository_id === "string" ||
        typeof existing.forgejo_repository_id === "string")
    ) {
      fail(
        "repository_identity_conflict",
        "Repository identity is already registered",
      );
    }
    try {
      await verifyRead(url, credential);
    } catch (error) {
      if (existing && error instanceof RepositoryError) {
        durableCore.transaction((transaction) => {
          const failed = transaction.run(
            `UPDATE repositories
             SET health = 'error',
                 health_error_code = ?,
                 health_error_message = ?
             WHERE id = ? AND lifecycle = 'retired'
               AND lifecycle_revision = ?`,
            error.code,
            error.message,
            existing.id,
            existing.lifecycle_revision,
          );
          if (failed.changes !== 1) {
            fail(
              "repository_lifecycle_conflict",
              "Repository changed during verification",
            );
          }
        });
      }
      throw error;
    }
    const id = existing?.id ?? createId();
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
    if (existing) {
      durableCore.transaction((transaction) => {
        const reactivated = transaction.run(
          `UPDATE repositories
           SET lifecycle = 'enabled',
               lifecycle_revision = lifecycle_revision + 1,
               health = 'healthy',
               health_error_code = NULL,
               health_error_message = NULL,
               verified_at = ?
           WHERE id = ? AND lifecycle = 'retired'
             AND lifecycle_revision = ?`,
          timestamp,
          id,
          existing.lifecycle_revision,
        );
        if (reactivated.changes !== 1) {
          fail(
            "repository_lifecycle_conflict",
            "Repository changed during reactivation",
          );
        }
        if (encryptedCredential) {
          transaction.run(
            "INSERT INTO repository_credentials (repository_id, encrypted_credential, created_at) VALUES (?, ?, ?)",
            id,
            encryptedCredential,
            timestamp,
          );
        }
      });
      return readRepositoryResource(find(id));
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
  };
}
