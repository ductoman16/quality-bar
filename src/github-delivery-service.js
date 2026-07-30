import {
  beginGitHubDeliveryAttempt,
  ensureGitHubDelivery,
  failGitHubDelivery,
  githubDeliveryFailure,
  proveGitHubDeliveryAbsent,
  succeedGitHubDelivery,
} from "./github-delivery.js";

/**
 * @param {any} durableCore
 * @param {{
 *   connectionId: string,
 *   create: () => Promise<number>,
 *   now: () => number,
 *   onDefinitive: (failure: any) => void,
 *   onSuccess: (externalId: number, publishedAt: number) => void,
 *   reconcile: () => Promise<number | null>,
 *   sourceId: string,
 *   surface: "aggregate_feedback" | "inline_feedback",
 *   target: string
 * }} input
 */
export async function attemptGitHubDelivery(durableCore, input) {
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
  if (
    !beginGitHubDeliveryAttempt(
      durableCore,
      input.connectionId,
      delivery,
      attemptedAt,
    )
  ) {
    return;
  }
  /** @type {"create" | "reconcile"} */
  let operation =
    delivery.reconciliation_required === 1 ? "reconcile" : "create";
  try {
    if (operation === "reconcile") {
      const reconciled = await input.reconcile();
      if (reconciled !== null) {
        succeedGitHubDelivery(durableCore, delivery, reconciled);
        input.onSuccess(reconciled, attemptedAt);
        return;
      }
      proveGitHubDeliveryAbsent(durableCore, delivery, attemptedAt);
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
        )
      ) {
        return;
      }
      operation = "create";
    }
    const externalId = await input.create();
    succeedGitHubDelivery(durableCore, delivery, externalId);
    input.onSuccess(externalId, attemptedAt);
  } catch (error) {
    const failure = githubDeliveryFailure(error, { operation });
    failGitHubDelivery(
      durableCore,
      delivery,
      attemptedAt,
      failure,
      input.connectionId,
    );
    if (failure.definitive) {
      input.onDefinitive(failure);
    }
  }
}
