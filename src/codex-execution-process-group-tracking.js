import { ReviewRunExecutionError } from "./review-run-result.js";
import { attachFailureDiagnostic } from "./review-run-codex-failure.js";

/** @param {unknown} finish @param {unknown} start */
export function requireTracking(finish, start) {
  if (typeof finish !== "function" || typeof start !== "function") {
    throw new TypeError(
      "Codex process-group tracking dependencies are invalid",
    );
  }
}

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {(processGroupId: number) => unknown} startProcessGroup
 * @param {(processGroupId: number) => unknown} bindProcessGroup
 * @param {() => Promise<void>} launch
 * @param {() => Promise<void>} closeSubmission
 * @param {() => Promise<void>} terminate
 * @param {() => unknown} finishProcessGroup
 */
export async function startSpawnedCodexProcessGroup(
  child,
  startProcessGroup,
  bindProcessGroup,
  launch,
  closeSubmission,
  terminate,
  finishProcessGroup,
) {
  let tracked = false;
  try {
    if (
      !Number.isSafeInteger(child.pid) ||
      /** @type {number} */ (child.pid) < 1
    ) {
      throw new ReviewRunExecutionError(
        "codex_process_failed",
        "Codex Review Run process group is unavailable",
      );
    }
    startProcessGroup(/** @type {number} */ (child.pid));
    tracked = true;
    bindProcessGroup(/** @type {number} */ (child.pid));
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
