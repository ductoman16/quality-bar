/**
 * @typedef {Error & { code: string }} CodedError
 */

/**
 * @param {unknown} error
 * @returns {CodedError}
 */
export function requireCodedError(error) {
  if (!(error instanceof Error)) {
    throw new TypeError("Caught value must be an Error", { cause: error });
  }
  if (!("code" in error) || typeof error.code !== "string") {
    throw error;
  }
  return /** @type {CodedError} */ (error);
}
