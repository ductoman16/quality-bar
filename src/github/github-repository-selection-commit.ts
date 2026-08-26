import { GitHubConnectionError } from "./github-connection-error.ts";
import { isUniqueConstraintFailure } from "../sqlite-error.ts";

function fail(code: string, message: string): never {
  throw new GitHubConnectionError(code, message);
}

export function requireCurrentGitHubRepositoryConnection(
  transaction: any,
  connection: any,
  connectionId: string,
) {
  const currentConnection = transaction.get(
    `SELECT github_connections.lifecycle,
            github_connections.health,
            github_connections.health_error_code,
            github_connections.health_error_message,
            github_connections.repository_count,
            github_connections.verified_at,
            (
              SELECT id FROM github_connection_verifications
               WHERE connection_id = github_connections.id
               ORDER BY rowid DESC LIMIT 1
            ) AS latest_verification_id,
            github_connection_credentials.encrypted_credential
     FROM github_connections
     LEFT JOIN github_connection_credentials
       ON github_connection_credentials.connection_id =
          github_connections.id
     WHERE github_connections.id = ?`,
    connectionId,
  );
  if (
    currentConnection?.lifecycle !== "enabled" ||
    currentConnection.health !== connection.health ||
    currentConnection.health_error_code !== connection.health_error_code ||
    currentConnection.health_error_message !==
      connection.health_error_message ||
    currentConnection.repository_count !== connection.repository_count ||
    currentConnection.verified_at !== connection.verified_at ||
    currentConnection.latest_verification_id !==
      connection.latest_verification_id ||
    currentConnection.encrypted_credential !== connection.encrypted_credential
  ) {
    fail(
      "github_repository_enablement_conflict",
      "GitHub Connection changed during Repository enablement",
    );
  }
}

export function requireCurrentGitHubRepositories(
  transaction: any,
  connectionId: string,
  existing: Map<number, any>,
  repositoryIds: number[],
  {
    code = "github_repository_enablement_conflict",
    message = "GitHub Repository changed during enablement",
  } = {},
) {
  for (const repositoryId of new Set(repositoryIds)) {
    const expected = existing.get(repositoryId);
    if (!expected) {
      const current = transaction.get(
        `SELECT repository_id
         FROM github_repositories
         WHERE connection_id = ? AND forge_repository_id = ?`,
        connectionId,
        repositoryId,
      );
      if (current) {
        fail(code, message);
      }
      continue;
    }
    const current = transaction.get(
      `SELECT repositories.lifecycle, repositories.lifecycle_revision,
              repositories.health, repositories.health_error_code,
              repositories.health_error_message, repositories.verified_at,
              github_repositories.verification_id,
              github_repositories.name, github_repositories.api_url,
              github_repositories.web_url
       FROM repositories
       JOIN github_repositories
         ON github_repositories.repository_id = repositories.id
       WHERE github_repositories.connection_id = ?
         AND github_repositories.forge_repository_id = ?
         AND repositories.id = ?`,
      connectionId,
      repositoryId,
      expected.id,
    );
    if (
      current?.lifecycle !== expected.lifecycle ||
      current.lifecycle_revision !== expected.lifecycleRevision ||
      current.health !== expected.health ||
      current.health_error_code !== expected.healthErrorCode ||
      current.health_error_message !== expected.healthErrorMessage ||
      current.verified_at !== expected.verifiedAt ||
      current.verification_id !== expected.verificationId ||
      current.name !== expected.name ||
      current.api_url !== expected.apiUrl ||
      current.web_url !== expected.webUrl
    ) {
      fail(code, message);
    }
  }
}

export function createGitHubRepositorySelectionCommit(input: any) {
  const {
    affectedRepositoryIds,
    connection,
    connectionId,
    deferCommit,
    records,
    removedVerifications,
    existing,
    verification,
    verified,
    verifier,
  } = input;
  return (transaction: any) => {
    try {
      requireCurrentGitHubRepositoryConnection(
        transaction,
        connection,
        connectionId,
      );
      requireCurrentGitHubRepositories(
        transaction,
        connectionId,
        existing,
        [...existing.keys()],
        deferCommit
          ? undefined
          : {
              code: "github_repository_identity_conflict",
              message: "GitHub Repository changed during registration",
            },
      );
      verified.commit(transaction);
      for (const removedVerification of removedVerifications) {
        removedVerification.commit(transaction);
      }
      verifier.commitPollingBaseline(verification, transaction, connectionId);
      for (const { existingRepository, id, repository } of records) {
        if (!existingRepository) {
          transaction.run(
            `INSERT INTO repositories (
               id, normalized_url, created_at, verified_at
             ) VALUES (?, ?, ?, ?)`,
            id,
            repository.clone_url,
            verified.verifiedAt,
            verified.verifiedAt,
          );
          transaction.run(
            `INSERT INTO github_repositories (
               repository_id, connection_id, forge_repository_id,
               name, api_url, web_url, verification_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            id,
            connection.id,
            repository.id,
            repository.full_name,
            repository.api_url,
            repository.html_url,
            verified.id,
          );
          continue;
        }
        const affected = affectedRepositoryIds.includes(repository.id);
        const lifecycleClause =
          !deferCommit && affected && existingRepository.lifecycle === "retired"
            ? `, lifecycle = 'enabled',
                 lifecycle_revision = lifecycle_revision + 1`
            : "";
        if (affected) {
          const lifecyclePredicate = " AND lifecycle = ?";
          const updated = transaction.run(
            `UPDATE repositories
             SET normalized_url = ?,
                 verified_at = ?,
                 health = 'healthy',
                 health_error_code = NULL,
                 health_error_message = NULL
                 ${lifecycleClause}
             WHERE id = ?${lifecyclePredicate}
               AND lifecycle_revision = ?`,
            repository.clone_url,
            verified.verifiedAt,
            id,
            existingRepository.lifecycle,
            existingRepository.lifecycleRevision,
          );
          if (updated.changes !== 1) {
            fail(
              deferCommit
                ? "github_repository_enablement_conflict"
                : "github_repository_identity_conflict",
              deferCommit
                ? "GitHub Repository changed during enablement"
                : "GitHub Repository changed during registration",
            );
          }
        } else {
          const updated = transaction.run(
            `UPDATE repositories SET normalized_url = ?
             WHERE id = ? AND lifecycle = ? AND lifecycle_revision = ?`,
            repository.clone_url,
            id,
            existingRepository.lifecycle,
            existingRepository.lifecycleRevision,
          );
          if (updated.changes !== 1) {
            fail(
              deferCommit
                ? "github_repository_enablement_conflict"
                : "github_repository_identity_conflict",
              deferCommit
                ? "GitHub Repository changed during enablement"
                : "GitHub Repository changed during registration",
            );
          }
        }
        const mappingUpdated = transaction.run(
          `UPDATE github_repositories
           SET name = ?, api_url = ?, web_url = ?${
             affected ? ", verification_id = ?" : ""
           }
           WHERE repository_id = ?`,
          repository.full_name,
          repository.api_url,
          repository.html_url,
          ...(affected ? [verified.id] : []),
          id,
        );
        if (mappingUpdated.changes !== 1) {
          fail(
            deferCommit
              ? "github_repository_enablement_conflict"
              : "github_repository_identity_conflict",
            deferCommit
              ? "GitHub Repository changed during enablement"
              : "GitHub Repository changed during registration",
          );
        }
      }
    } catch (error) {
      if (
        isUniqueConstraintFailure(error, "repositories.normalized_url") ||
        isUniqueConstraintFailure(
          error,
          "github_repositories.connection_id, github_repositories.forge_repository_id",
        )
      ) {
        fail(
          "github_repository_identity_conflict",
          "GitHub Repository identity is already registered",
        );
      }
      throw error;
    }
  };
}
