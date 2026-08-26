import { ReviewRunExecutionError } from "./review-run-result.ts";

export const REVIEW_RUN_DEADLINE_MILLISECONDS = 15 * 60 * 1_000;

export function requireDeadlineRecorder(recordDeadline: unknown) {
  if (typeof recordDeadline !== "function") {
    throw new TypeError("Review Run deadline recorder is required");
  }
}

export function createDeadlineFailure(
  deadlineExpired: boolean,
  accepted: boolean,
) {
  return deadlineExpired && !accepted
    ? new ReviewRunExecutionError(
        "deadline_exceeded",
        "Codex Review Run exceeded its 15-minute deadline",
      )
    : undefined;
}

export function captureDeadlineRecordingFailure(
  recordDeadline: (failure: ReviewRunExecutionError) => unknown,
  deadlineFailure: ReviewRunExecutionError | undefined,
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

export function attachDeadlineCleanupFailures(
  deadlineFailure: Error,
  recordingFailure: unknown,
  diagnostics: {
    evidenceCompletionFailure: unknown;
    submissionFailure: unknown;
    transcriptFailure: unknown;
  },
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
