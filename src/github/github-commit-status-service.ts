import { createForgeCommitStatusService } from "../forge/commit-status/service.ts";
import { readStatusTarget } from "../forge/commit-status/target.ts";
import {
  attemptGitHubDelivery,
  recordGitHubDeliveryHealth,
} from "./github-delivery-service.ts";

export function createGitHubCommitStatusService(
  durableCore: any,
  {
    cipher,
    externalOrigin,
    ioPool,
    now = () => Date.now(),
    verifier,
  }: {
    cipher: {
      decrypt: (
        connection: { appId: number; id: string },
        encrypted: string,
      ) => any;
    };
    externalOrigin: string;
    ioPool: {
      run: (duty: "delivery", operation: () => unknown) => Promise<unknown>;
    };
    now?: () => number;
    verifier: {
      publishCommitStatus: (...parameters: any[]) => Promise<number>;
      reconcileCommitStatus: (...parameters: any[]) => Promise<number | null>;
    };
  },
) {
  if (
    typeof cipher?.decrypt !== "function" ||
    typeof verifier?.publishCommitStatus !== "function" ||
    typeof verifier.reconcileCommitStatus !== "function"
  ) {
    throw new TypeError("GitHub commit status dependencies are invalid");
  }
  return createForgeCommitStatusService(durableCore, {
    externalOrigin,
    ioPool,
    now,
    provider: "GitHub",
    dedupSources: true,
    fetchWaitingRows: (core) =>
      core.all(
        `SELECT
           github_commit_statuses.evaluation_id,
           github_commit_statuses.repository_id,
           github_commit_statuses.head_commit,
           github_commit_statuses.desired_state,
           evaluation_results.outcome AS result_outcome,
           github_repositories.forge_repository_id,
           github_repositories.name,
           github_connections.id AS connection_id,
           github_connections.app_id,
           github_connections.app_slug,
           github_connections.installation_id,
           github_connections.principal_id,
           github_connections.principal_login,
           github_connection_credentials.encrypted_credential
         FROM github_commit_statuses
         JOIN github_repositories
           ON github_repositories.repository_id =
                github_commit_statuses.repository_id
         JOIN github_connections
           ON github_connections.id = github_repositories.connection_id
         JOIN github_connection_credentials
           ON github_connection_credentials.connection_id =
                github_connections.id
         LEFT JOIN evaluation_results
           ON evaluation_results.evaluation_id =
                github_commit_statuses.evaluation_id
         WHERE github_commit_statuses.publication_status = 'waiting'
         ORDER BY github_commit_statuses.repository_id,
                  github_commit_statuses.head_commit
          `,
      ),
    attemptDelivery: (core, { row, statusTarget, target, now: nowFn }) => {
      const repository = {
        full_name: row.name as string,
        id: row.forge_repository_id as number,
      };
      const credentialIdentity = {
        appId: row.app_id as number,
        id: row.connection_id as string,
      };
      const credentialInput = {
        app_id: row.app_id,
        app_slug: row.app_slug,
        owner: {
          id: row.principal_id,
          login: row.principal_login,
          type: "User",
        },
      };
      const authentication = () => {
        const credential = cipher.decrypt(
          credentialIdentity,
          row.encrypted_credential as string,
        );
        return {
          ...credentialInput,
          client_id: credential.client_id,
          pem: credential.pem,
        };
      };
      return attemptGitHubDelivery(core, {
        connectionId: row.connection_id as string,
        create: (deliveryTarget) =>
          verifier.publishCommitStatus(
            authentication(),
            row.installation_id as number,
            repository,
            readStatusTarget(
              deliveryTarget,
              statusTarget,
              repository.id,
              "GitHub",
            ),
          ),
        now: nowFn,
        onDefinitive: (transaction, failure, attemptedAt) => {
          transaction.run(
            `UPDATE github_commit_statuses
               SET publication_status = 'unavailable',
                   error_code = ?,
                   error_detail = ?
               WHERE repository_id = ?
                 AND head_commit = ?
                 AND evaluation_id = ?
                 AND desired_state = ?
                 AND publication_status = 'waiting'`,
            failure.code,
            failure.detail,
            row.repository_id,
            row.head_commit,
            row.evaluation_id,
            row.desired_state,
          );
          recordGitHubDeliveryHealth(
            transaction,
            row.connection_id as string,
            attemptedAt,
            failure,
          );
        },
        onSuccess: (transaction, externalId, publishedAt) => {
          if (!Number.isSafeInteger(externalId)) {
            throw new TypeError("GitHub status identity is invalid");
          }
          transaction.run(
            `UPDATE github_commit_statuses
               SET publication_status = 'succeeded',
                   published_state = desired_state,
                   published_at = ?,
                   error_code = NULL,
                   error_detail = NULL
               WHERE repository_id = ?
                 AND head_commit = ?
                 AND evaluation_id = ?
                 AND desired_state = ?
                 AND publication_status = 'waiting'`,
            publishedAt,
            row.repository_id,
            row.head_commit,
            row.evaluation_id,
            row.desired_state,
          );
        },
        reconcile: (deliveryTarget) =>
          verifier.reconcileCommitStatus(
            authentication(),
            row.installation_id as number,
            repository,
            readStatusTarget(
              deliveryTarget,
              statusTarget,
              repository.id,
              "GitHub",
            ),
          ),
        sourceId: `${row.evaluation_id}:${row.desired_state}`,
        surface: "commit_status",
        target,
      });
    },
  });
}
