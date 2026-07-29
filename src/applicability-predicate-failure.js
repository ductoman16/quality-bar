import { trace } from "./applicability-evidence.js";

/**
 * @param {unknown} cause
 * @param {any} context
 * @param {string} predicateId
 * @param {string | undefined} side
 * @param {string} fallbackDetail
 */
export function predicateFailure(
  cause,
  context,
  predicateId,
  side,
  fallbackDetail,
) {
  const owned =
    cause instanceof Error &&
    "code" in cause &&
    typeof cause.code === "string" &&
    /^[a-z][a-z0-9_]*$/.test(cause.code);
  if (!owned) {
    throw cause;
  }
  return {
    ...trace("error"),
    error: {
      code: cause.code,
      detail: cause.message.trim().length > 0 ? cause.message : fallbackDetail,
      file_change_id: context.file?.id,
      predicate_id: predicateId,
      side,
    },
  };
}
