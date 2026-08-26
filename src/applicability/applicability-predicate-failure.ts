import { trace } from "./applicability-evidence.ts";

export function predicateFailure(
  cause: unknown,
  context: any,
  predicateId: string,
  side: string | undefined,
  fallbackDetail: string,
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
