import {
  beginGitHubDeliveryAttempt,
  ensureGitHubDelivery,
  failGitHubDelivery,
  githubDeliveryFailure,
  proveGitHubDeliveryAbsent,
  succeedGitHubDelivery,
} from "./github-delivery.ts";
import { githubVerificationErrorScope } from "./github-verification-scope.ts";

export function recordGitHubDeliveryHealth(
  transaction: any,
  connectionId: string,
  attemptedAt: number,
  failure: any,
) {
  const connectionOwned =
    [
      "github_app_profile_mismatch",
      "github_connection_credential_invalid",
      "github_connection_credential_undecryptable",
      "github_installation_scope_invalid",
      "github_permissions_mismatch",
      "github_principal_mismatch",
    ].includes(failure.code) ||
    (failure.code === "github_api_request_failed" &&
      [401, 403].includes(failure.responseStatus));
  if (
    githubVerificationErrorScope(failure.code) === "repository" &&
    Number.isSafeInteger(failure.repositoryId)
  ) {
    transaction.run(
      `UPDATE repositories
       SET health = 'error',
           health_error_code = ?,
           health_error_message = ?,
           verified_at = ?
       WHERE id = (
         SELECT repository_id FROM github_repositories
         WHERE connection_id = ? AND forge_repository_id = ?
       )`,
      failure.code,
      failure.detail,
      attemptedAt,
      connectionId,
      failure.repositoryId,
    );
    return;
  }
  if (!connectionOwned) {
    return;
  }
  transaction.run(
    `UPDATE github_connections
     SET health = 'error',
         health_error_code = ?,
         health_error_message = ?,
         verified_at = ?
     WHERE id = ?`,
    failure.code,
    failure.detail,
    attemptedAt,
    connectionId,
  );
}

export async function attemptGitHubDelivery(
  durableCore: any,
  input: {
    connectionId: string;
    create: (target: string) => Promise<number>;
    now: () => number;
    onDefinitive: (transaction: any, failure: any, attemptedAt: number) => void;
    onSuccess: (
      transaction: any,
      externalId: number,
      publishedAt: number,
    ) => void;
    reconcile: (target: string) => Promise<number | null>;
    sourceId: string;
    surface: "commit_status" | "aggregate_feedback" | "inline_feedback";
    target: string;
  },
) {
  let delivery = ensureGitHubDelivery(
    durableCore,
    input.surface,
    input.sourceId,
    input.target,
  );
  const attemptedAt = input.now();
  if (!Number.isSafeInteger(attemptedAt) || attemptedAt < 0) {
    throw new TypeError("now must return a nonnegative safe integer");
  }
  if (delivery.external_id !== null) {
    succeedGitHubDelivery(
      durableCore,
      input.connectionId,
      delivery,
      delivery.external_id,
      (transaction) =>
        input.onSuccess(transaction, delivery.external_id, attemptedAt),
    );
    return;
  }
  let operation: "create" | "reconcile" =
    delivery.reconciliation_required === 1 ? "reconcile" : "create";
  if (
    !beginGitHubDeliveryAttempt(
      durableCore,
      input.connectionId,
      delivery,
      attemptedAt,
      operation,
    )
  ) {
    return;
  }
  try {
    if (operation === "reconcile") {
      const reconciled = await input.reconcile(delivery.target);
      if (reconciled !== null) {
        succeedGitHubDelivery(
          durableCore,
          input.connectionId,
          delivery,
          reconciled,
          (transaction) =>
            input.onSuccess(transaction, reconciled, attemptedAt),
        );
        return;
      }
      if (
        !proveGitHubDeliveryAbsent(
          durableCore,
          input.connectionId,
          delivery,
          attemptedAt,
          input.target,
        )
      ) {
        return;
      }
      delivery = ensureGitHubDelivery(
        durableCore,
        input.surface,
        input.sourceId,
        input.target,
      );
      if (
        !beginGitHubDeliveryAttempt(
          durableCore,
          input.connectionId,
          delivery,
          attemptedAt,
          "create",
        )
      ) {
        return;
      }
      operation = "create";
    }
    const externalId = await input.create(delivery.target);
    succeedGitHubDelivery(
      durableCore,
      input.connectionId,
      delivery,
      externalId,
      (transaction) => input.onSuccess(transaction, externalId, attemptedAt),
    );
  } catch (error) {
    const failure = githubDeliveryFailure(error, { operation });
    failGitHubDelivery(
      durableCore,
      delivery,
      attemptedAt,
      failure,
      input.connectionId,
      (transaction, definitiveFailure) =>
        input.onDefinitive(transaction, definitiveFailure, attemptedAt),
    );
  }
}
