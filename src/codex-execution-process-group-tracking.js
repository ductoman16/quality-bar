import { ReviewRunExecutionError } from "./review-run-result.js";

/** @param {unknown} finish @param {unknown} track */
export function requireTracking(finish, track) {
  if (typeof finish !== "function" || typeof track !== "function") {
    throw new TypeError(
      "Codex process-group tracking dependencies are invalid",
    );
  }
}

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {(processGroupId: number) => unknown} track
 * @param {() => Promise<void>} closeSubmission
 * @param {() => Promise<void>} terminate
 */
export async function trackSpawnedCodexProcessGroup(
  child,
  track,
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
    track(/** @type {number} */ (child.pid));
  } catch (error) {
    await closeSubmission();
    await terminate();
    throw error;
  }
}
