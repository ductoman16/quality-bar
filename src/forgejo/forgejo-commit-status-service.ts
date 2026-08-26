import { createForgeCommitStatusService } from "../forge/commit-status/service.ts";
import { readStatusTarget } from "../forge/commit-status/target.ts";
import {
  attemptForgejoDelivery,
  recordForgejoDeliveryHealth,
} from "./forgejo-delivery-service.ts";

export function createForgejoCommitStatusService(
  durableCore: any,
  {
    cipher,
    externalOrigin,
    ioPool,
    now = () => Date.now(),
    verifier,
  }: {
    cipher: { decrypt: (connectionId: string, encrypted: string) => string };
    externalOrigin: string;
    ioPool: {
      run: (duty: "delivery", operation: () => unknown) => Promise<unknown>;
    };
    now?: () => number;
    verifier: {
      publishCommitStatus: (
        connection: any,
        repository: any,
        status: any,
      ) => Promise<number>;
      reconcileCommitStatus: (
        connection: any,
        repository: any,
        status: any,
      ) => Promise<number | null>;
    };
  },
) {
  if (
    typeof cipher?.decrypt !== "function" ||
    typeof verifier?.publishCommitStatus !== "function" ||
    typeof verifier.reconcileCommitStatus !== "function"
  ) {
    throw new TypeError("Forgejo commit status dependencies are invalid");
  }
  return createForgeCommitStatusService(durableCore, {
    externalOrigin,
    ioPool,
    now,
    provider: "Forgejo",
    dedupSources: false,
    fetchWaitingRows: (core) =>
      core.all(
        `SELECT
           forgejo_commit_statuses.evaluation_id,
           forgejo_commit_statuses.repository_id,
           forgejo_commit_statuses.head_commit,
           forgejo_commit_statuses.desired_state,
           evaluation_results.outcome AS result_outcome,
           forgejo_repositories.forge_repository_id,
           forgejo_repositories.name,
           forgejo_connections.id AS connection_id,
           forgejo_connections.base_url,
           forgejo_connection_credentials.encrypted_credential
         FROM forgejo_commit_statuses
         JOIN forgejo_repositories
           ON forgejo_repositories.repository_id =
                forgejo_commit_statuses.repository_id
         JOIN forgejo_connections
           ON forgejo_connections.id = forgejo_repositories.connection_id
         JOIN forgejo_connection_credentials
           ON forgejo_connection_credentials.connection_id =
                forgejo_connections.id
         LEFT JOIN evaluation_results
           ON evaluation_results.evaluation_id =
                forgejo_commit_statuses.evaluation_id
         WHERE forgejo_commit_statuses.publication_status = 'waiting'
           AND forgejo_connections.lifecycle = 'enabled'
           AND forgejo_connections.health = 'healthy'
           AND EXISTS (
             SELECT 1 FROM repositories
             WHERE repositories.id = forgejo_commit_statuses.repository_id
               AND repositories.lifecycle != 'retired'
               AND repositories.health = 'healthy'
           )
         ORDER BY forgejo_commit_statuses.repository_id,
                  forgejo_commit_statuses.head_commit`,
      ),
    attemptDelivery: (core, { row, statusTarget, target, now: nowFn }) => {
      const repository = {
        full_name: row.name as string,
        id: row.forge_repository_id as number,
      };
      const authentication = () => ({
        base_url: row.base_url as string,
        token: cipher.decrypt(
          row.connection_id as string,
          row.encrypted_credential as string,
        ),
      });
      const deliver = (method: any, deliveryTarget: string) =>
        method(
          authentication(),
          repository,
          readStatusTarget(
            deliveryTarget,
            statusTarget,
            repository.id,
            "Forgejo",
          ),
        );
      return attemptForgejoDelivery(core, {
        connectionId: row.connection_id as string,
        create: (deliveryTarget) =>
          deliver(verifier.publishCommitStatus, deliveryTarget),
        now: nowFn,
        onDefinitive: (transaction, failure, attemptedAt) => {
          transaction.run(
            `UPDATE forgejo_commit_statuses
               SET publication_status = 'unavailable', published_state = NULL,
                   published_at = NULL, external_id = NULL,
                   error_code = ?, error_detail = ?
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
          recordForgejoDeliveryHealth(
            transaction,
            row.connection_id as string,
            attemptedAt,
            failure,
          );
        },
        onSuccess: (transaction, externalId, publishedAt) =>
          transaction.run(
            `UPDATE forgejo_commit_statuses
               SET publication_status = 'succeeded',
                   published_state = desired_state, published_at = ?,
                   external_id = ?, error_code = NULL, error_detail = NULL
               WHERE repository_id = ?
                 AND head_commit = ?
                 AND evaluation_id = ?
                 AND desired_state = ?
                 AND publication_status = 'waiting'`,
            publishedAt,
            externalId,
            row.repository_id,
            row.head_commit,
            row.evaluation_id,
            row.desired_state,
          ),
        reconcile: (deliveryTarget) =>
          deliver(verifier.reconcileCommitStatus, deliveryTarget),
        repositoryId: row.repository_id as string,
        sourceId: `${row.evaluation_id}:${row.desired_state}`,
        surface: "commit_status",
        target,
      });
    },
  });
}
