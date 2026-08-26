import { ReviewRunExecutionError } from "../review/review-run-result.ts";
import { attachFailureDiagnostic } from "../review/review-run-codex-failure.ts";

export function requireTracking(finish: unknown, start: unknown) {
  if (typeof finish !== "function" || typeof start !== "function") {
    throw new TypeError(
      "Codex process-group tracking dependencies are invalid",
    );
  }
}

export async function startSpawnedCodexProcessGroup(
  child: import("node:child_process").ChildProcess,
  startProcessGroup: (processGroupId: number) => unknown,
  bindProcessGroup: (processGroupId: number) => unknown,
  launch: () => Promise<void>,
  closeSubmission: () => Promise<void>,
  terminate: () => Promise<void>,
  finishProcessGroup: () => unknown,
) {
  let tracked = false;
  try {
    if (!Number.isSafeInteger(child.pid) || (child.pid as number) < 1) {
      throw new ReviewRunExecutionError(
        "codex_process_failed",
        "Codex Review Run process group is unavailable",
      );
    }
    startProcessGroup(child.pid as number);
    tracked = true;
    bindProcessGroup(child.pid as number);
    await launch();
  } catch (error) {
    const owningFailure =
      error instanceof Error
        ? error
        : new TypeError("Codex process-group tracking failed", {
            cause: error,
          });
    let submissionCloseFailure;
    let submissionCloseFailed = false;
    try {
      await closeSubmission();
    } catch (failure) {
      submissionCloseFailed = true;
      submissionCloseFailure =
        failure instanceof Error
          ? failure
          : new TypeError("Codex submission close failed", { cause: failure });
    }
    let terminationFailure;
    let terminationFailed = false;
    try {
      await terminate();
    } catch (failure) {
      terminationFailed = true;
      terminationFailure =
        failure instanceof Error
          ? failure
          : new TypeError("Codex process-group termination failed", {
              cause: failure,
            });
    }
    let processGroupFinishFailure;
    let processGroupFinishFailed = false;
    if (tracked && !terminationFailed) {
      try {
        await finishProcessGroup();
      } catch (failure) {
        processGroupFinishFailed = true;
        processGroupFinishFailure =
          failure instanceof Error
            ? failure
            : new TypeError("Codex process-group tracking cleanup failed", {
                cause: failure,
              });
      }
    }
    if (submissionCloseFailed) {
      attachFailureDiagnostic(
        owningFailure,
        "submissionCloseFailure",
        submissionCloseFailure,
      );
    }
    if (terminationFailed) {
      attachFailureDiagnostic(
        owningFailure,
        "terminationFailure",
        terminationFailure,
      );
    }
    if (processGroupFinishFailed) {
      attachFailureDiagnostic(
        owningFailure,
        "processGroupFinishFailure",
        processGroupFinishFailure,
      );
    }
    throw owningFailure;
  }
}
