import { readStatusTarget } from "./github-commit-status-service.js";
import {
  readAggregateDeliveryTarget,
  readInlineDeliveryTarget,
} from "./github-feedback-delivery-target.js";

/** @param {string} serialized @param {any} fallback @param {number} repositoryId */
export function readForgejoStatusTarget(serialized, fallback, repositoryId) {
  return readStatusTarget(serialized, fallback, repositoryId, "Forgejo");
}

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
