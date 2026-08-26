import {
  completeForgejoReactivationVerification,
  failedForgejoReactivationVerification,
} from "./forgejo-connection-reactivation-verification.ts";
import { failedForgejoRepositoryChecks } from "./forgejo-repository-check.ts";
import { resumeForgejoRepositoryDeliveries as resume } from "./forgejo-delivery-recovery.ts";
import {
  codedForgejoRepositoryFailure,
  commitForgejoRepositoryFailures,
  normalizeForgejoRepositoryFailureOwners,
} from "./forgejo-repository-failure-commit.ts";
import {
  forgejoDefinitiveFailureScope,
  isForgejoRepositoryFailure,
} from "./forgejo-failure.ts";
import { updateForgejoConnectionFailureHealth } from "./forgejo-failure-health.ts";
import {
  requireCurrentForgejoConnection,
  requireCurrentForgejoPollingGeneration,
  requireCurrentForgejoRepositories,
} from "./forgejo-repository-enablement-fence.ts";
import { isUniqueConstraintFailure } from "../sqlite-error.ts";

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

export async function prepareForgejoRepositoryEnablement(
  durableCore: { all: Function; transaction: Function },
  cipher: { decrypt: (id: string, encrypted: string) => string },
  verifier: { verify: (input: any) => Promise<any> },
  polling: {
    commitBaseline: Function;
    commitFailure: Function;
    prepareBaseline: Function;
  },
  createId: () => string | undefined,
  now: () => number,
  forgeRepositoryId: number,
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
      (repository: any) =>
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
  const repositoryIds = repositories.map((repository: any) =>
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
  let completedVerification: any | undefined;
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
      commit(transaction: any) {
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
              (candidate: any) => candidate.id === repository.id,
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
    const failureRepositoryIds = normalizeForgejoRepositoryFailureOwners(
      repositoryIds,
      error,
      repositoryChecks,
    );
    const scope = forgejoDefinitiveFailureScope(error);
    const commit = (transaction: any) => {
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
      const connectionUpdate = updateForgejoConnectionFailureHealth(
        transaction,
        connection.id,
        scope,
        verifiedAt,
      );
      if (connectionUpdate.changes !== 1) {
        fail(
          "forgejo_repository_enablement_conflict",
          "Forgejo Connection changed during Repository enablement",
        );
      }
      if (
        scope === "repository" &&
        !commitForgejoRepositoryFailures(
          transaction,
          error,
          connection.id,
          failureRepositoryIds,
          verificationId,
          verifiedAt,
        )
      ) {
        fail(
          "forgejo_repository_enablement_conflict",
          "Forgejo Connection changed during Repository enablement",
        );
      }
      if (
        Number.isSafeInteger(error.attemptedAt) &&
        (!isForgejoRepositoryFailure(error) ||
          failureRepositoryIds.length > 0) &&
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
      failureRepositoryIds.length !== 1 ||
      failureRepositoryIds[0] !== forgeRepositoryId
    ) {
      durableCore.transaction(commit);
      throw error;
    }
    throw Object.assign(error, { commit });
  }
}
