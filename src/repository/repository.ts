import { randomUUID } from "node:crypto";

import { CHECKOUTS_PATH } from "../installation-environment.ts";
import { createRepositoryCollection } from "./repository-collection.ts";
import { createRepositoryCredentialCipher } from "./repository-credential.ts";
import {
  commitRepositoryEnablement,
  recordPreparedRepositoryVerificationFailure,
} from "./repository-enablement.ts";
import {
  resolvePushedCommitSelectors,
  verifyRepositoryRead,
} from "./repository-git.ts";
import { createRepositoryGitCredentialAcquirer } from "./repository-git-credential.ts";
import {
  readRepositoryResource,
  REPOSITORY_SELECTION,
} from "./repository-resource.ts";
import {
  removeNeverUsedRepository,
  retireUsedRepository,
} from "./repository-removal.ts";
import { createRepositoryRegistration } from "./repository-registration.ts";
import {
  assertRepositoryAcceptsNewWork,
  fail,
  failUnavailable,
  normalizeRepositoryCredentialRotation,
  normalizeRepositoryLifecycleChange,
  normalizePublicRepositoryUrl,
  RepositoryError,
} from "./repository-validation.ts";
import { createRepositorySelectorResolver } from "./repository-selector.ts";

export { RepositoryError };

export type RepositoryDurableCore = {
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

export function createRepositoryService(
  durableCore: RepositoryDurableCore,
  {
    certificateAuthorityPath,
    createId = randomUUID,
    masterKey,
    now = () => Date.now(),
    objectDatabaseRoot = CHECKOUTS_PATH,
    registerSecret,
    verifyRead = verifyRepositoryRead,
    verifyForgeRepository,
    resolveForgeCredential,
    resolveSelectors = resolvePushedCommitSelectors,
  }: {
    certificateAuthorityPath?: string;
    createId?: () => string;
    masterKey: Buffer;
    now?: () => number;
    registerSecret?: (secret: string) => unknown;
    objectDatabaseRoot?: string;
    verifyRead?: (
      normalizedUrl: string,
      credential: { token: string; username: string } | undefined,
      options?: { certificateAuthorityPath?: string },
    ) => Promise<void>;
    verifyForgeRepository?: (
      forgeRepositoryId: number,
      provider: "github" | "forgejo",
    ) => Promise<{ commit?: (transaction: any) => void } | void>;
    resolveForgeCredential?: (
      connectionId: string,
      provider: "github" | "forgejo",
    ) =>
      | Promise<{ token: string; username: string }>
      | { token: string; username: string };
    resolveSelectors?: (
      normalizedUrl: string,
      credential: { token: string; username: string } | undefined,
      request: unknown,
      options: {
        certificateAuthorityPath?: string;
        objectDatabaseRoot: string;
        pullRequestProvider?: "forgejo" | "github";
        useMergeBase?: boolean;
      },
    ) => Promise<import("./repository-git.ts").ResolvedPushedCommitSelectors>;
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
  const credentialCipher = createRepositoryCredentialCipher(masterKey, {
    onSecret: registerSecret,
  });
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
          id: row.id as string,
          url: row.normalized_url as string,
        },
        row.encrypted_credential as string,
      );
    }
  } catch (error) {
    credentialCipher.destroy();
    throw error;
  }

  function find(id: string) {
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

  const acquireGitCredential = createRepositoryGitCredentialAcquirer({
    credentialCipher,
    find,
    readRepository: readRepositoryResource,
    resolveForgeCredential,
  });

  function requireAcceptsNewWork(id: string) {
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
      failUnavailable(
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
    certificateAuthorityPath,
    credentialCipher,
    find,
    objectDatabaseRoot,
    requireAcceptsNewWork,
    resolveForgeCredential,
    resolveSelectors,
  });
  const registerRepository = createRepositoryRegistration({
    credentialCipher,
    createId,
    durableCore,
    find,
    now,
    registerSecret,
    verifyRead: (url, credential) =>
      verifyRead(url, credential, { certificateAuthorityPath }),
  });

  return {
    acquireGitCredential,
    list() {
      return durableCore
        .all(
          `${REPOSITORY_SELECTION}
           ORDER BY repositories.normalized_url, repositories.id`,
        )
        .map(readRepositoryResource);
    },
    listPage({
      cursor,
      limit,
      remoteUrl,
    }: { cursor?: string; limit?: string; remoteUrl?: string } = {}) {
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
    register: registerRepository,
    async rotateCredential(id: string, request: unknown) {
      const credential = normalizeRepositoryCredentialRotation(request);
      const row = find(id);
      if (typeof row.encrypted_credential !== "string") {
        fail(
          "repository_credential_not_found",
          "Repository has no credential to rotate",
        );
      }
      const url = row.normalized_url as string;
      // prettier-ignore
      [credential.token, credential.username].forEach((secret) => registerSecret?.(secret));
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
    remove(id: string) {
      removeNeverUsedRepository(durableCore as any, id);
    },
    resolvePullRequestChangeset(
      id: string,
      pullRequest: { baseSha: string; headSha: string },
    ) {
      return resolvePushedSelectors(
        id,
        {
          base: { type: "commit", value: pullRequest?.baseSha },
          head: { type: "commit", value: pullRequest?.headSha },
        },
        { pullRequestProvider: "github", useMergeBase: true },
      );
    },
    resolveForgejoPullRequestChangeset(
      id: string,
      pullRequest: { baseSha: string; headSha: string },
    ) {
      return resolvePushedSelectors(
        id,
        {
          base: { type: "commit", value: pullRequest?.baseSha },
          head: { type: "commit", value: pullRequest?.headSha },
        },
        { pullRequestProvider: "forgejo", useMergeBase: false },
      );
    },
    resolvePushedSelectors,
    async setLifecycle(id: string, request: unknown) {
      const { lifecycle } = normalizeRepositoryLifecycleChange(request);
      const row = find(id);
      const repository = readRepositoryResource(row);
      const lifecycleRevision = row?.lifecycle_revision as number;
      if (!Number.isSafeInteger(lifecycleRevision) || lifecycleRevision < 0) {
        throw new TypeError("Repository lifecycle revision is invalid");
      }
      if (repository.lifecycle === "retired") {
        if (lifecycle === "retired") {
          return repository;
        }
        if (lifecycle === "disabled") {
          fail(
            "repository_retired",
            "Repository retirement must be reversed through reactivation",
          );
        }
        if (!("forge_repository_id" in repository)) {
          fail(
            "repository_reactivation_requires_registration",
            "Retired Generic HTTPS Repository must be re-registered",
          );
        }
      }
      if (lifecycle === "retired") {
        retireUsedRepository(durableCore as any, id, {
          lifecycle: repository.lifecycle,
          lifecycleRevision,
        });
        return readRepositoryResource(find(id));
      }
      if (lifecycle === "disabled") {
        durableCore.transaction((transaction) => {
          const disabled = transaction.run(
            `UPDATE repositories
             SET lifecycle = 'disabled',
                 lifecycle_revision = lifecycle_revision + 1
             WHERE id = ? AND lifecycle = ? AND lifecycle_revision = ?`,
            id,
            repository.lifecycle,
            lifecycleRevision,
          );
          if (disabled.changes !== 1) {
            fail(
              "repository_lifecycle_conflict",
              "Repository changed during lifecycle update",
            );
          }
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
      let preparedEnablement: { commit?: (transaction: any) => void } | void =
        undefined;
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
        recordPreparedRepositoryVerificationFailure(durableCore, error, {
          id: repository.id,
          lifecycle: repository.lifecycle,
          lifecycleRevision,
        });
        throw error;
      }
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp)) {
        throw new TypeError("now must return a safe integer timestamp");
      }
      commitRepositoryEnablement(durableCore, preparedEnablement, {
        id,
        lifecycle: repository.lifecycle,
        lifecycleRevision,
        timestamp,
      });
      return readRepositoryResource(find(id));
    },
    destroy() {
      repositoryCollection.destroy();
      credentialCipher.destroy();
    },
  };
}
