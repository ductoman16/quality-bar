import {
  completeForgejoReactivationVerification,
  failedForgejoReactivationVerification,
} from "./forgejo-connection-reactivation-verification.js";
import { failedForgejoRepositoryChecks } from "./forgejo-repository-check.js";
import { resumeForgejoRepositoryDeliveries as resume } from "./forgejo-delivery-recovery.js";
import {
  codedForgejoRepositoryFailure,
  commitForgejoRepositoryFailure,
  resolveForgejoRepositoryFailureOwner,
} from "./forgejo-repository-failure-commit.js";
import {
  requireCurrentForgejoConnection,
  requireCurrentForgejoPollingGeneration,
  requireCurrentForgejoRepositories,
} from "./forgejo-repository-enablement-fence.js";
import { forgejoVerificationErrorScope } from "./forgejo-verification-scope.js";
import { isUniqueConstraintFailure } from "./sqlite-error.js";

/** @param {string} code @param {string} message @returns {never} */
function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

/** @param {{all: Function, transaction: Function}} durableCore @param {{decrypt: (id: string, encrypted: string) => string}} cipher @param {{verify: (input: any) => Promise<any>}} verifier @param {{commitBaseline: Function, commitFailure: Function, prepareBaseline: Function}} polling @param {() => string | undefined} createId @param {() => number} now @param {number} forgeRepositoryId */
export async function prepareForgejoRepositoryEnablement(
  durableCore,
  cipher,
  verifier,
  polling,
  createId,
  now,
  forgeRepositoryId,
) {
  if (!Number.isSafeInteger(forgeRepositoryId) || forgeRepositoryId <= 0) {
    throw new TypeError("Forgejo Repository identity is invalid");
  }
  const [connection] = durableCore.all(
    `SELECT forgejo_connections.id, forgejo_connections.base_url,
            forgejo_connections.principal_id,
            forgejo_connections.principal_login,
            forgejo_connections.health, forgejo_connections.verified_at,
            forgejo_connection_credentials.encrypted_credential,
            (
              SELECT id FROM forgejo_connection_verifications
               WHERE connection_id = forgejo_connections.id
               ORDER BY rowid DESC LIMIT 1
            ) AS latest_verification_id,
            (
              SELECT value FROM quality_bar_metadata
               WHERE key = 'forgejo_poll_generation:' ||
                           forgejo_connections.id
            ) AS poll_generation
       FROM forgejo_connections
       JOIN forgejo_connection_credentials
         ON forgejo_connection_credentials.connection_id =
            forgejo_connections.id
       JOIN forgejo_repositories
         ON forgejo_repositories.connection_id = forgejo_connections.id
      WHERE forgejo_repositories.forge_repository_id = ?
        AND forgejo_connections.lifecycle = 'enabled'`,
    forgeRepositoryId,
  );
  if (
    !connection ||
    typeof connection.id !== "string" ||
    typeof connection.base_url !== "string" ||
    !Number.isSafeInteger(connection.principal_id) ||
    typeof connection.principal_login !== "string" ||
    !["error", "healthy"].includes(connection.health) ||
    !Number.isSafeInteger(connection.verified_at) ||
    typeof connection.latest_verification_id !== "string" ||
    typeof connection.encrypted_credential !== "string"
  ) {
    fail("forgejo_repository_not_found", "Forgejo Repository was not found");
  }
  if (
    connection.poll_generation !== null &&
    (typeof connection.poll_generation !== "string" ||
      !/^(0|[1-9]\d*)$/u.test(connection.poll_generation) ||
      !Number.isSafeInteger(Number(connection.poll_generation)))
  ) {
    throw new TypeError("Forgejo polling generation is invalid");
  }
  const expectedGeneration =
    connection.poll_generation === null
      ? 0
      : Number(connection.poll_generation);
  const repositories = durableCore.all(
    `SELECT forgejo_repositories.forge_repository_id AS id,
            forgejo_repositories.name AS full_name,
            repositories.lifecycle,
            repositories.lifecycle_revision,
            repositories.health,
            repositories.health_error_code,
            repositories.health_error_message,
            repositories.verified_at,
            forgejo_repositories.verification_id
       FROM forgejo_repositories
       JOIN repositories
         ON repositories.id = forgejo_repositories.repository_id
       JOIN forgejo_repository_polls
         ON forgejo_repository_polls.connection_id =
              forgejo_repositories.connection_id
        AND forgejo_repository_polls.forge_repository_id =
              forgejo_repositories.forge_repository_id
      WHERE forgejo_repositories.connection_id = ?
        AND (
          forgejo_repository_polls.baseline_status != 'complete'
          OR forgejo_repositories.forge_repository_id = ?
        )
        AND (
          repositories.lifecycle = 'enabled'
          OR forgejo_repositories.forge_repository_id = ?
        )
      ORDER BY forgejo_repositories.forge_repository_id`,
    connection.id,
    forgeRepositoryId,
    forgeRepositoryId,
  );
  if (
    repositories.length === 0 ||
    repositories.some(
      (/** @type {any} */ repository) =>
        !Number.isSafeInteger(repository?.id) ||
        typeof repository?.full_name !== "string" ||
        !["disabled", "enabled", "retired"].includes(repository?.lifecycle) ||
        !Number.isSafeInteger(repository?.lifecycle_revision) ||
        !["error", "healthy"].includes(repository?.health) ||
        (repository?.health_error_code !== null &&
          typeof repository?.health_error_code !== "string") ||
        (repository?.health_error_message !== null &&
          typeof repository?.health_error_message !== "string") ||
        !Number.isSafeInteger(repository?.verified_at) ||
        typeof repository?.verification_id !== "string",
    )
  ) {
    throw new TypeError("Forgejo Repository baseline set is invalid");
  }
  const repositoryIds = repositories.map((/** @type {any} */ repository) =>
    Number(repository.id),
  );
  const verificationId = createId();
  const verifiedAt = now();
  if (
    typeof verificationId !== "string" ||
    verificationId.length === 0 ||
    !Number.isSafeInteger(verifiedAt)
  ) {
    throw new TypeError("Forgejo Connection verification identity is invalid");
  }
  const token = cipher.decrypt(connection.id, connection.encrypted_credential);
  /** @type {any | undefined} */
  let completedVerification;
  try {
    completedVerification = completeForgejoReactivationVerification(
      await verifier.verify({
        baseUrl: connection.base_url,
        repositoryIds,
        token,
      }),
      repositoryIds,
    );
    if (
      completedVerification.principal.id !== connection.principal_id ||
      completedVerification.principal.login !== connection.principal_login
    ) {
      fail(
        "forgejo_principal_invalid",
        "Forgejo principal does not match the configured Connection",
      );
    }
    const prepared = await polling.prepareBaseline(
      { base_url: connection.base_url, id: connection.id },
      token,
      repositories,
      { ignoreGate: true, recordFailure: false },
    );
    return {
      /** @param {any} transaction */
      commit(transaction) {
        try {
          requireCurrentForgejoConnection(transaction, connection);
          requireCurrentForgejoPollingGeneration(
            transaction,
            connection.id,
            expectedGeneration,
          );
          requireCurrentForgejoRepositories(
            transaction,
            connection.id,
            repositories,
          );
          transaction.run(
            "INSERT INTO forgejo_connection_verifications (id, connection_id, trigger, profile, reported_version, principal, scopes, capabilities, repositories, error_code, error_message, verified_at) VALUES (?, ?, 'enablement', ?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
            verificationId,
            connection.id,
            completedVerification.profile,
            completedVerification.reported_version,
            JSON.stringify(completedVerification.principal),
            JSON.stringify(completedVerification.scopes),
            JSON.stringify(completedVerification.capabilities),
            JSON.stringify(completedVerification.repositories),
            verifiedAt,
          );
          const connectionUpdate = transaction.run(
            `UPDATE forgejo_connections
           SET reported_version = ?, scopes = ?, capabilities = ?,
               health = 'healthy', verified_at = ?
           WHERE id = ? AND lifecycle = 'enabled'`,
            completedVerification.reported_version,
            JSON.stringify(completedVerification.scopes),
            JSON.stringify(completedVerification.capabilities),
            verifiedAt,
            connection.id,
          );
          if (connectionUpdate.changes !== 1) {
            fail(
              "forgejo_repository_enablement_conflict",
              "Forgejo Connection changed during Repository enablement",
            );
          }
          for (const repository of completedVerification.repositories) {
            const expectedRepository = repositories.find(
              (/** @type {any} */ candidate) => candidate.id === repository.id,
            );
            if (!expectedRepository) {
              fail(
                "forgejo_repository_enablement_conflict",
                "Forgejo Repository changed during enablement",
              );
            }
            const mappingUpdate = transaction.run(
              `UPDATE forgejo_repositories
             SET verification_id = ?, name = ?, api_url = ?, web_url = ?
             WHERE connection_id = ? AND forge_repository_id = ?`,
              verificationId,
              repository.full_name,
              repository.api_url,
              repository.html_url,
              connection.id,
              repository.id,
            );
            const identityUpdate = transaction.run(
              `UPDATE repositories
             SET normalized_url = ?,
                 verified_at = ?,
                 health = 'healthy',
                 health_error_code = NULL,
                 health_error_message = NULL
             WHERE id = (
               SELECT repository_id FROM forgejo_repositories
               WHERE connection_id = ? AND forge_repository_id = ?
             ) AND lifecycle = ? AND lifecycle_revision = ?`,
              repository.clone_url,
              verifiedAt,
              connection.id,
              repository.id,
              expectedRepository.lifecycle,
              expectedRepository.lifecycle_revision,
            );
            if (mappingUpdate.changes !== 1 || identityUpdate.changes !== 1) {
              fail(
                "forgejo_repository_enablement_conflict",
                "Forgejo Connection changed during Repository enablement",
              );
            }
          }
          resume(transaction, connection.id, verifiedAt, repositoryIds);
          if (
            !polling.commitBaseline(
              transaction,
              connection.id,
              prepared,
              expectedGeneration,
            )
          ) {
            fail(
              "forgejo_repository_enablement_conflict",
              "Forgejo Connection changed during Repository enablement",
            );
          }
        } catch (error) {
          if (isUniqueConstraintFailure(error, "repositories.normalized_url")) {
            fail(
              "forgejo_repository_identity_conflict",
              "Forgejo Repository identity is already registered",
            );
          }
          throw error;
        }
      },
    };
  } catch (caught) {
    const error = codedForgejoRepositoryFailure(caught);
    const failedEvidence =
      completedVerification ??
      failedForgejoReactivationVerification(error, repositoryIds);
    const repositoryChecks =
      failedEvidence?.repositories ??
      failedForgejoRepositoryChecks(error, repositoryIds);
    const failureRepositoryId = resolveForgejoRepositoryFailureOwner(
      repositoryIds,
      error,
      repositoryChecks,
    );
    if (failureRepositoryId === undefined) {
      delete error.repositoryId;
    } else {
      error.repositoryId = failureRepositoryId;
    }
    const scope = forgejoVerificationErrorScope(error.code, error.repositoryId);
    /** @param {any} transaction */
    const commit = (transaction) => {
      requireCurrentForgejoConnection(transaction, connection);
      requireCurrentForgejoPollingGeneration(
        transaction,
        connection.id,
        expectedGeneration,
      );
      requireCurrentForgejoRepositories(
        transaction,
        connection.id,
        repositories,
      );
      transaction.run(
        "INSERT INTO forgejo_connection_verifications (id, connection_id, trigger, profile, reported_version, principal, scopes, capabilities, repositories, error_code, error_message, verified_at) VALUES (?, ?, 'enablement', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        verificationId,
        connection.id,
        failedEvidence?.profile ?? null,
        failedEvidence?.reported_version ?? null,
        failedEvidence?.principal
          ? JSON.stringify(failedEvidence.principal)
          : null,
        failedEvidence?.scopes ? JSON.stringify(failedEvidence.scopes) : null,
        failedEvidence?.capabilities
          ? JSON.stringify(failedEvidence.capabilities)
          : null,
        JSON.stringify(repositoryChecks),
        error.code,
        error.message,
        verifiedAt,
      );
      const connectionUpdate = transaction.run(
        `UPDATE forgejo_connections
         SET health = ?, verified_at = ?
         WHERE id = ? AND lifecycle = 'enabled'`,
        scope === "connection" ? "error" : "healthy",
        verifiedAt,
        connection.id,
      );
      if (connectionUpdate.changes !== 1) {
        fail(
          "forgejo_repository_enablement_conflict",
          "Forgejo Connection changed during Repository enablement",
        );
      }
      if (scope === "repository" && failureRepositoryId !== undefined) {
        if (
          !commitForgejoRepositoryFailure(
            transaction,
            error,
            connection.id,
            failureRepositoryId,
            verificationId,
            verifiedAt,
          )
        ) {
          fail(
            "forgejo_repository_enablement_conflict",
            "Forgejo Connection changed during Repository enablement",
          );
        }
      }
      if (
        Number.isSafeInteger(error.attemptedAt) &&
        (scope !== "repository" || failureRepositoryId !== undefined) &&
        !polling.commitFailure(
          transaction,
          connection.id,
          repositoryIds,
          error,
          error.attemptedAt,
          true,
          expectedGeneration,
        )
      ) {
        fail(
          "forgejo_repository_enablement_conflict",
          "Forgejo Connection changed during Repository enablement",
        );
      }
    };
    if (
      scope === "connection" ||
      failureRepositoryId === undefined ||
      failureRepositoryId !== forgeRepositoryId
    ) {
      durableCore.transaction(commit);
      throw error;
    }
    throw Object.assign(error, { commit });
  }
}
