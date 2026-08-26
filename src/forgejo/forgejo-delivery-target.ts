import {
  readAggregateDeliveryTarget,
  readInlineDeliveryTarget,
} from "../github/github-feedback-delivery-target.ts";

export function readForgejoAggregateTarget(
  serialized: string,
  fallback: any,
  repositoryId: number,
) {
  return readAggregateDeliveryTarget(
    serialized,
    fallback,
    repositoryId,
    "Forgejo",
  );
}

export function readForgejoInlineTarget(
  serialized: string,
  fallback: any,
  repositoryId: number,
) {
  return readInlineDeliveryTarget(
    serialized,
    fallback,
    repositoryId,
    "Forgejo",
  );
}
