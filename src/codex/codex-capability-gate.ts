import { requireCodedError } from "../coded-error.ts";

export function readLiveCodexCapabilityFailure(
  cachedFailure: import("../coded-error.ts").CodedError | null,
  validateAuthentication: () => unknown,
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
