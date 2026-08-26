import {
  beginForgejoDeliveryAttempt,
  ensureForgejoDelivery,
  failForgejoDelivery,
  forgejoDeliveryFailure,
  proveForgejoDeliveryAbsent,
  succeedForgejoDelivery,
} from "./forgejo-delivery.ts";
import { forgejoDefinitiveFailureScope } from "./forgejo-failure.ts";

export function recordForgejoDeliveryHealth(
  transaction: any,
  connectionId: string,
  attemptedAt: number,
  failure: any,
) {
  if (
    forgejoDefinitiveFailureScope(failure) === "repository" &&
    Number.isSafeInteger(failure.repositoryId)
  ) {
    transaction.run(
      `UPDATE repositories
       SET health = 'error', health_error_code = ?,
           health_error_message = ?, verified_at = ?
       WHERE id = (
         SELECT repository_id FROM forgejo_repositories
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
  const connectionOwned =
    failure.definitive &&
    forgejoDefinitiveFailureScope(failure) === "connection";
  if (!connectionOwned) {
    return;
  }
  transaction.run(
    `UPDATE forgejo_connections SET health = 'error', verified_at = ?
     WHERE id = ?`,
    attemptedAt,
    connectionId,
  );
}

export async function attemptForgejoDelivery(
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
    repositoryId: string;
    sourceId: string;
    surface: "commit_status" | "aggregate_feedback" | "inline_feedback";
    target: string;
  },
) {
  let delivery = ensureForgejoDelivery(
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
    succeedForgejoDelivery(
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
    !beginForgejoDeliveryAttempt(
      durableCore,
      input.connectionId,
      input.repositoryId,
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
        succeedForgejoDelivery(
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
        !proveForgejoDeliveryAbsent(
          durableCore,
          input.connectionId,
          delivery,
          attemptedAt,
          input.target,
        )
      ) {
        return;
      }
      delivery = ensureForgejoDelivery(
        durableCore,
        input.surface,
        input.sourceId,
        input.target,
      );
      if (
        !beginForgejoDeliveryAttempt(
          durableCore,
          input.connectionId,
          input.repositoryId,
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
    succeedForgejoDelivery(
      durableCore,
      input.connectionId,
      delivery,
      externalId,
      (transaction) => input.onSuccess(transaction, externalId, attemptedAt),
    );
  } catch (error) {
    const failure = forgejoDeliveryFailure(error, { operation });
    failForgejoDelivery(
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
