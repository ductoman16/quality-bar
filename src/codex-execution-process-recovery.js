import { DurableCoreError } from "./durable-error.js";
import {
  codexProcessGroupHasLiveMember,
  readCodexProcessIdentity,
  requireCodexProcessIdentity,
} from "./codex-process-identity.js";

const PROCESS_TERMINATION_GRACE_MILLISECONDS = 5_000;
const PROCESS_TERMINATION_POLL_MILLISECONDS = 50;
const WAIT_SIGNAL = new Int32Array(new SharedArrayBuffer(4));

/** @param {unknown} error */
function processGroupAbsent(error) {
  return (
    error instanceof Error && "code" in error && String(error.code) === "ESRCH"
  );
}

/** @param {() => boolean} isActive */
function waitForTrackedProcessGroupExit(isActive) {
  const deadline = Date.now() + PROCESS_TERMINATION_GRACE_MILLISECONDS;
  while (Date.now() < deadline) {
    Atomics.wait(
      WAIT_SIGNAL,
      0,
      0,
      Math.min(PROCESS_TERMINATION_POLL_MILLISECONDS, deadline - Date.now()),
    );
    if (!isActive()) {
      return true;
    }
  }
  return !isActive();
}

/**
 * @param {{bootIdentity: string, namespaceIdentity: string, startIdentity: string}} expected
 * @param {{bootIdentity: string, namespaceIdentity: string, startIdentity: string}} actual
 */
function sameProcessIdentity(expected, actual) {
  return (
    expected.bootIdentity === actual.bootIdentity &&
    expected.namespaceIdentity === actual.namespaceIdentity &&
    expected.startIdentity === actual.startIdentity
  );
}

/**
 * @param {{processGroupId: number, bootIdentity: string, namespaceIdentity: string, startIdentity: string}} tracked
 * @param {{
 *   hasLiveProcessGroupMember?: typeof codexProcessGroupHasLiveMember,
 *   killProcessGroup?: (processId: number, signal: NodeJS.Signals | 0) => unknown,
 *   readProcessIdentity?: typeof readCodexProcessIdentity,
 *   waitForExit?: (isActive: () => boolean) => boolean
 * }} [options]
 */
export function terminateTrackedCodexProcessGroup(
  tracked,
  {
    hasLiveProcessGroupMember = codexProcessGroupHasLiveMember,
    killProcessGroup = process.kill,
    readProcessIdentity = readCodexProcessIdentity,
    waitForExit = waitForTrackedProcessGroupExit,
  } = {},
) {
  const processGroupId = tracked?.processGroupId;
  if (
    !Number.isSafeInteger(processGroupId) ||
    processGroupId < 1 ||
    typeof hasLiveProcessGroupMember !== "function" ||
    typeof killProcessGroup !== "function" ||
    typeof readProcessIdentity !== "function" ||
    typeof waitForExit !== "function"
  ) {
    throw new TypeError("Tracked Codex process group is invalid");
  }
  const expectedIdentity = requireCodexProcessIdentity(tracked);
  const target = -processGroupId;
  let terminationRequested = false;
  function isActive() {
    try {
      killProcessGroup(target, 0);
    } catch (error) {
      if (processGroupAbsent(error)) {
        return false;
      }
      if (terminationRequested) {
        try {
          if (!hasLiveProcessGroupMember(processGroupId)) {
            return false;
          }
        } catch (inspectionError) {
          throw new DurableCoreError(
            "codex_execution_process_group_termination_failed",
            "Tracked Codex process group could not be inspected",
            { cause: inspectionError },
          );
        }
      }
      throw new DurableCoreError(
        "codex_execution_process_group_termination_failed",
        "Tracked Codex process group could not be inspected",
        { cause: error },
      );
    }
    let actualIdentity;
    try {
      actualIdentity = requireCodexProcessIdentity(
        readProcessIdentity(processGroupId),
      );
    } catch (error) {
      try {
        killProcessGroup(processGroupId, 0);
      } catch (inspectionError) {
        if (processGroupAbsent(inspectionError)) {
          let hostIdentity;
          try {
            hostIdentity = requireCodexProcessIdentity(
              readProcessIdentity(process.pid),
            );
          } catch (hostError) {
            throw new DurableCoreError(
              "codex_execution_process_identity_unavailable",
              "Tracked Codex process host identity could not be verified",
              { cause: hostError },
            );
          }
          if (
            expectedIdentity.bootIdentity !== hostIdentity.bootIdentity ||
            expectedIdentity.namespaceIdentity !==
              hostIdentity.namespaceIdentity
          ) {
            throw new DurableCoreError(
              "codex_execution_process_identity_changed",
              "Tracked Codex process identity changed before recovery",
            );
          }
          return true;
        }
        throw new DurableCoreError(
          "codex_execution_process_identity_unavailable",
          "Tracked Codex process identity could not be verified",
          { cause: inspectionError },
        );
      }
      throw new DurableCoreError(
        "codex_execution_process_identity_unavailable",
        "Tracked Codex process identity could not be verified",
        { cause: error },
      );
    }
    if (!sameProcessIdentity(expectedIdentity, actualIdentity)) {
      throw new DurableCoreError(
        "codex_execution_process_identity_changed",
        "Tracked Codex process identity changed before recovery",
      );
    }
    if (terminationRequested) {
      try {
        if (!hasLiveProcessGroupMember(processGroupId)) {
          return false;
        }
      } catch (error) {
        throw new DurableCoreError(
          "codex_execution_process_group_termination_failed",
          "Tracked Codex process group could not be inspected",
          { cause: error },
        );
      }
    }
    return true;
  }

  if (!isActive()) {
    return null;
  }
  try {
    killProcessGroup(target, "SIGTERM");
    terminationRequested = true;
  } catch (error) {
    if (processGroupAbsent(error)) {
      return null;
    }
    throw new DurableCoreError(
      "codex_execution_process_group_termination_failed",
      "Tracked Codex process group could not be terminated",
      { cause: error },
    );
  }
  if (waitForExit(isActive)) {
    return "SIGTERM";
  }
  try {
    killProcessGroup(target, "SIGKILL");
    return "SIGKILL";
  } catch (error) {
    if (processGroupAbsent(error)) {
      return "SIGTERM";
    }
    throw new DurableCoreError(
      "codex_execution_process_group_termination_failed",
      "Tracked Codex process group could not be force-terminated",
      { cause: error },
    );
  }
}
