import {
  readAggregateDeliveryTarget,
  readInlineDeliveryTarget,
} from "../github/github-feedback-delivery-target.js";

/** @param {string} serialized @param {any} fallback @param {number} repositoryId */
export function readForgejoAggregateTarget(serialized, fallback, repositoryId) {
  return readAggregateDeliveryTarget(
    serialized,
    fallback,
    repositoryId,
    "Forgejo",
  );
}

/** @param {string} serialized @param {any} fallback @param {number} repositoryId */
export function readForgejoInlineTarget(serialized, fallback, repositoryId) {
  return readInlineDeliveryTarget(
    serialized,
    fallback,
    repositoryId,
    "Forgejo",
  );
}
