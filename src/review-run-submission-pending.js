/**
 * @param {{
 *   acknowledgmentPath: string,
 *   acknowledgmentIdentity: {dev: number, ino: number} | null,
 *   setAcknowledgmentIdentity: (identity: {dev: number, ino: number}) => void,
 *   failUnexpectedly: (error: unknown) => void,
 *   isMissingPath: (error: unknown) => boolean,
 *   isPendingClientAlive: (submission: any) => boolean,
 *   isSubmissionLeaseAlive: (submission: any) => boolean | null,
 *   isSubmissionLeaseExpired: (submission: any) => boolean,
 *   lockPath: string,
 *   parseSubmissionLock: (submission: any) => any,
 *   pendingResponse: {accepted: boolean, client_id: string, client_pid: number, client_start_identity: string, request_id: string, validationFailure: any} | null,
 *   readSubmissionFile: (path: string, unavailable: () => Error) => any,
 *   removeOwnedFile: (path: string, identity: any) => void,
 *   requestChannelUnavailable: () => Error,
 *   resolveResult: (result: "accepted" | "failed") => void,
 *   responseIdentity: {dev: number, ino: number} | null,
 *   responsePath: string,
 *   setLastValidationFailure: (failure: any) => void,
 *   settlePendingResponse: (result: "accepted" | "failed") => void,
 *   stopAccepting: () => void,
 * }} input
 */
export function processPendingResponse(input) {
  if (!input.pendingResponse) {
    return {
      acknowledgmentIdentity: input.acknowledgmentIdentity,
      accepted: false,
      handled: false,
      pendingResponse: input.pendingResponse,
      responseIdentity: input.responseIdentity,
    };
  }
  let acknowledgment = null;
  try {
    acknowledgment = input.readSubmissionFile(
      input.acknowledgmentPath,
      input.requestChannelUnavailable,
    );
  } catch (error) {
    if (!input.isMissingPath(error)) {
      input.failUnexpectedly(error);
      return { handled: true };
    }
  }
  if (!acknowledgment) {
    let lockSubmission;
    try {
      lockSubmission = input.readSubmissionFile(
        input.lockPath,
        input.requestChannelUnavailable,
      );
    } catch (error) {
      if (!input.isMissingPath(error)) {
        if (input.isPendingClientAlive(input.pendingResponse)) {
          return { handled: true };
        }
        input.failUnexpectedly(error);
        return { handled: true };
      }
    }
    const lock = lockSubmission
      ? input.parseSubmissionLock(lockSubmission)
      : null;
    const leaseAlive = lockSubmission
      ? input.isSubmissionLeaseAlive(lockSubmission)
      : false;
    const ownershipChanged =
      lock !== null &&
      (lock.client_id !== input.pendingResponse.client_id ||
        lock.client_pid !== input.pendingResponse.client_pid ||
        lock.client_start_identity !==
          input.pendingResponse.client_start_identity ||
        lock.request_id !== input.pendingResponse.request_id);
    const discard =
      !lockSubmission ||
      ownershipChanged ||
      leaseAlive === false ||
      (leaseAlive === null &&
        lock === null &&
        input.isSubmissionLeaseExpired(lockSubmission));
    if (discard) {
      try {
        if (input.responseIdentity) {
          input.removeOwnedFile(input.responsePath, input.responseIdentity);
        }
      } catch (cleanupFailure) {
        input.failUnexpectedly(cleanupFailure);
        return { handled: true };
      }
      input.resolveResult("failed");
      input.settlePendingResponse("failed");
      return {
        acknowledgmentIdentity: input.acknowledgmentIdentity,
        accepted: false,
        handled: true,
        pendingResponse: null,
        responseIdentity: null,
      };
    }
    return { handled: true };
  }
  try {
    const envelope = JSON.parse(acknowledgment.content);
    if (
      envelope.client_id !== input.pendingResponse.client_id ||
      envelope.client_pid !== input.pendingResponse.client_pid ||
      envelope.client_start_identity !==
        input.pendingResponse.client_start_identity ||
      envelope.request_id !== input.pendingResponse.request_id
    ) {
      throw input.requestChannelUnavailable();
    }
    input.setAcknowledgmentIdentity(acknowledgment.identity);
    input.removeOwnedFile(input.acknowledgmentPath, acknowledgment.identity);
    input.removeOwnedFile(input.responsePath, input.responseIdentity);
    const completed = input.pendingResponse;
    if (completed.accepted) {
      input.stopAccepting();
      input.resolveResult("accepted");
    } else {
      input.setLastValidationFailure(completed.validationFailure);
    }
    input.settlePendingResponse(completed.accepted ? "accepted" : "failed");
    return {
      acknowledgmentIdentity: acknowledgment.identity,
      accepted: completed.accepted,
      handled: true,
      pendingResponse: null,
      responseIdentity: null,
    };
  } catch (error) {
    input.failUnexpectedly(error);
    return { handled: true };
  }
}
