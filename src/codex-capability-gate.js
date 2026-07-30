import { requireCodedError } from "./coded-error.js";

/**
 * @param {import("./coded-error.js").CodedError | null} cachedFailure
 * @param {() => unknown} validateAuthentication
 */
export function readLiveCodexCapabilityFailure(
  cachedFailure,
  validateAuthentication,
) {
  if (cachedFailure) {
    return cachedFailure;
  }
  try {
    validateAuthentication();
    return null;
  } catch (error) {
    return requireCodedError(error);
  }
}
