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
 * @param {() => Promise<void>} launch
 * @param {() => Promise<void>} closeSubmission
 * @param {() => Promise<void>} terminate
 */
export async function startSpawnedCodexProcessGroup(
  child,
  startProcessGroup,
  launch,
  closeSubmission,
  terminate,
) {
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
    await launch();
  } catch (error) {
    let submissionCloseFailure;
    try {
      await closeSubmission();
    } catch (failure) {
      submissionCloseFailure = failure;
    }
    let terminationFailure;
    try {
      await terminate();
    } catch (failure) {
      terminationFailure = failure;
    }
    if (error instanceof Error) {
      if (submissionCloseFailure !== undefined) {
        attachFailureDiagnostic(
          error,
          "submissionCloseFailure",
          submissionCloseFailure,
        );
      }
      if (terminationFailure !== undefined) {
        attachFailureDiagnostic(
          error,
          "terminationFailure",
          terminationFailure,
        );
      }
    }
    throw error;
  }
}
