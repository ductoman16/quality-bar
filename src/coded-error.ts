export type CodedError = Error & { code: string };

export function requireCodedError(error: unknown): CodedError {
  if (!(error instanceof Error)) {
    throw new TypeError("Caught value must be an Error", { cause: error });
  }
  if (!("code" in error) || typeof error.code !== "string") {
    throw error;
  }
  return error as CodedError;
}
