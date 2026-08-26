import { createHmac, timingSafeEqual } from "node:crypto";

function hasValidRequestSignature(envelope: any, token: string) {
  if (typeof envelope.request_signature !== "string") {
    return false;
  }
  const payload = {
    candidate: envelope.candidate,
    client_id: envelope.client_id,
    client_pid: envelope.client_pid,
    client_process_group_id: envelope.client_process_group_id,
    client_start_identity: envelope.client_start_identity,
    request_id: envelope.request_id,
  };
  const expected = createHmac("sha256", token)
    .update(JSON.stringify(payload))
    .digest();
  const received = Buffer.from(envelope.request_signature, "base64");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

export function createSubmissionProcessor(input: {
  claim: any;
  failUnexpectedly: (error: unknown) => void;
  identities: { lockIdentity: any; requestIdentity: any };
  isMissingPath: (error: unknown) => boolean;
  isProcessAlive: (pid: number) => boolean;
  isProcessDescendant: (pid: number, ancestorPid: number) => boolean;
  processGroupIdentity: (pid: number) => number | null;
  processStartIdentity: (pid: number) => string | null;
  trustedProcessGroup: () => {
    groupId: number;
    leaderStartIdentity: string;
  } | null;
  isSubmissionLeaseAlive: (submission: any) => boolean | null;
  isSubmissionLeaseExpired: (submission: any) => boolean;
  lockPath: string;
  parseSubmissionLock: (submission: any) => any;
  processPendingResponse: () => boolean;
  readSubmissionFile: (path: string, unavailable: () => Error) => any;
  removeOwnedFile: (path: string, identity: any) => void;
  requestPath: string;
  resultService: any;
  resolveResult: (result: "accepted" | "failed") => void;
  state: {
    accepted: boolean;
    committed: boolean;
    lastValidationFailure: any;
    pendingResponse: any;
    processing: boolean;
    stopped: boolean;
  };
  submissionChannelUnavailable: () => Error;
  token: string;
  writeResponse: (response: Record<string, unknown>, requestId: string) => void;
}) {
  function shouldDiscardLease(lockSubmission: any) {
    const leaseAlive = input.isSubmissionLeaseAlive(lockSubmission);
    return (
      leaseAlive === false ||
      (leaseAlive === null &&
        input.parseSubmissionLock(lockSubmission) === null &&
        input.isSubmissionLeaseExpired(lockSubmission))
    );
  }

  return function processSubmission() {
    if (input.state.stopped || input.state.processing) {
      return;
    }
    if (input.processPendingResponse()) {
      return;
    }
    const trustedProcessGroup = input.trustedProcessGroup();
    if (trustedProcessGroup === null) {
      return;
    }
    let lockSubmission = null;
    try {
      lockSubmission = input.readSubmissionFile(
        input.lockPath,
        input.submissionChannelUnavailable,
      );
    } catch (error) {
      if (!input.isMissingPath(error)) {
        input.failUnexpectedly(error);
        return;
      }
    }
    let submission;
    try {
      submission = input.readSubmissionFile(
        input.requestPath,
        input.submissionChannelUnavailable,
      );
    } catch (error) {
      if (input.isMissingPath(error)) {
        if (lockSubmission) {
          if (shouldDiscardLease(lockSubmission)) {
            try {
              input.removeOwnedFile(input.lockPath, lockSubmission.identity);
            } catch (cleanupFailure) {
              input.failUnexpectedly(cleanupFailure);
              return;
            }
            input.resolveResult("failed");
          }
        }
        return;
      }
      input.failUnexpectedly(error);
      return;
    }
    if (!lockSubmission) {
      input.failUnexpectedly(input.submissionChannelUnavailable());
      return;
    }
    if (shouldDiscardLease(lockSubmission)) {
      try {
        input.removeOwnedFile(input.requestPath, submission.identity);
        input.removeOwnedFile(input.lockPath, lockSubmission.identity);
      } catch (cleanupFailure) {
        input.failUnexpectedly(cleanupFailure);
        return;
      }
      input.resolveResult("failed");
      return;
    }
    input.identities.lockIdentity = lockSubmission.identity;
    input.identities.requestIdentity = submission.identity;
    input.state.processing = true;
    let requestId = null;
    let envelope;
    let lock;
    let verifiedClientStartIdentity = null;
    try {
      envelope = JSON.parse(submission.content);
      input.removeOwnedFile(
        input.requestPath,
        input.identities.requestIdentity,
      );
      if (!hasValidRequestSignature(envelope, input.token)) {
        throw input.submissionChannelUnavailable();
      }
      if (typeof envelope.request_id !== "string") {
        throw input.submissionChannelUnavailable();
      }
      lock = input.parseSubmissionLock(lockSubmission);
      if (
        lock === null ||
        lock.client_id !== envelope.client_id ||
        lock.client_pid !== envelope.client_pid ||
        lock.client_process_group_id !== envelope.client_process_group_id ||
        lock.client_start_identity !== envelope.client_start_identity ||
        lock.request_id !== envelope.request_id
      ) {
        throw input.submissionChannelUnavailable();
      }
      if (!input.isProcessAlive(envelope.client_pid)) {
        input.removeOwnedFile(input.lockPath, input.identities.lockIdentity);
        input.resolveResult("failed");
        return;
      }
      if (input.isSubmissionLeaseAlive(lockSubmission) !== true) {
        throw input.submissionChannelUnavailable();
      }
      verifiedClientStartIdentity = input.processStartIdentity(
        envelope.client_pid,
      );
      const observedProcessGroup = input.processGroupIdentity(
        envelope.client_pid,
      );
      if (
        typeof verifiedClientStartIdentity !== "string" ||
        envelope.client_process_group_id !== trustedProcessGroup.groupId ||
        (observedProcessGroup !== trustedProcessGroup.groupId &&
          !input.isProcessDescendant(
            envelope.client_pid,
            trustedProcessGroup.groupId,
          )) ||
        !input.isProcessAlive(trustedProcessGroup.groupId) ||
        input.processStartIdentity(trustedProcessGroup.groupId) !==
          trustedProcessGroup.leaderStartIdentity ||
        input.processGroupIdentity(trustedProcessGroup.groupId) !==
          trustedProcessGroup.groupId
      ) {
        throw input.submissionChannelUnavailable();
      }
      if (
        input.processStartIdentity(envelope.client_pid) !==
        verifiedClientStartIdentity
      ) {
        throw input.submissionChannelUnavailable();
      }
      requestId = envelope.request_id;
      input.resultService.prepare(input.claim, envelope.candidate);
      input.state.committed = true;
      input.writeResponse({ ok: true }, requestId);
      input.state.pendingResponse = {
        accepted: true,
        client_id: lock.client_id,
        client_pid: envelope.client_pid,
        client_start_identity: lock.client_start_identity,
        verified_client_start_identity: verifiedClientStartIdentity,
        request_id: requestId,
        validationFailure: null,
      };
    } catch (error) {
      if (!(error instanceof ReviewRunExecutionError)) {
        if (requestId === null) {
          input.failUnexpectedly(error);
          return;
        }
        try {
          input.writeResponse(
            {
              error: {
                code: "submission_channel_unavailable",
                message: "Review Run submission channel is unavailable",
              },
              ok: false,
            },
            requestId,
          );
        } catch (responseFailure) {
          input.failUnexpectedly(responseFailure);
          return;
        }
        input.failUnexpectedly(error);
        return;
      }
      if (requestId === null || lock === null) {
        input.failUnexpectedly(error);
        return;
      }
      input.state.lastValidationFailure = error;
      if (typeof verifiedClientStartIdentity !== "string") {
        input.failUnexpectedly(input.submissionChannelUnavailable());
        return;
      }
      try {
        input.writeResponse(
          {
            error: { code: error.code, message: error.message },
            ok: false,
          },
          requestId,
        );
        input.state.pendingResponse = {
          accepted: false,
          client_id: lock.client_id,
          client_pid: envelope.client_pid,
          client_start_identity: lock.client_start_identity,
          verified_client_start_identity: verifiedClientStartIdentity,
          request_id: requestId,
          validationFailure: error,
        };
      } catch (responseFailure) {
        input.failUnexpectedly(responseFailure);
      }
    } finally {
      input.state.processing = false;
    }
  };
}
import { ReviewRunExecutionError } from "./review-run-result.ts";
