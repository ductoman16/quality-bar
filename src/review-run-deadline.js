import { ReviewRunExecutionError } from "./review-run-result.js";

/** @param {unknown} recordDeadline */
export function requireDeadlineRecorder(recordDeadline) {
  if (typeof recordDeadline !== "function") {
    throw new TypeError("Review Run deadline recorder is required");
  }
}

/** @param {boolean} deadlineExpired @param {boolean} accepted */
export function createDeadlineFailure(deadlineExpired, accepted) {
  return deadlineExpired && !accepted
    ? new ReviewRunExecutionError(
        "deadline_exceeded",
        "Codex Review Run exceeded its 15-minute deadline",
      )
    : undefined;
}

/**
 * @param {(failure: ReviewRunExecutionError) => unknown} recordDeadline
 * @param {ReviewRunExecutionError | undefined} deadlineFailure
 */
export function captureDeadlineRecordingFailure(
  recordDeadline,
  deadlineFailure,
) {
  if (!deadlineFailure) {
    return undefined;
  }
  try {
    recordDeadline(deadlineFailure);
  } catch (error) {
    return error;
  }
}

/**
 * @param {Error} deadlineFailure
 * @param {unknown} recordingFailure
 * @param {{evidenceCompletionFailure: unknown, submissionFailure: unknown, transcriptFailure: unknown}} diagnostics
 */
export function attachDeadlineCleanupFailures(
  deadlineFailure,
  recordingFailure,
  diagnostics,
) {
  const owningFailure =
    recordingFailure instanceof Error ? recordingFailure : deadlineFailure;
  if (diagnostics.evidenceCompletionFailure instanceof Error) {
    Object.defineProperty(owningFailure, "evidenceCompletionFailure", {
      configurable: true,
      enumerable: false,
      value: diagnostics.evidenceCompletionFailure,
    });
  }
  if (diagnostics.submissionFailure instanceof Error) {
    Object.defineProperty(owningFailure, "submissionFailure", {
      configurable: true,
      enumerable: false,
      value: diagnostics.submissionFailure,
    });
  }
  if (diagnostics.transcriptFailure instanceof Error) {
    Object.defineProperty(owningFailure, "transcriptFailure", {
      configurable: true,
      enumerable: false,
      value: diagnostics.transcriptFailure,
    });
  }
  return owningFailure;
}
