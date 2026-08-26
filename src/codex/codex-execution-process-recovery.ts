import { DurableCoreError } from "../durable/durable-error.ts";
import {
  codexProcessGroupHasLiveMember,
  readCodexProcessIdentity,
  requireCodexProcessIdentity,
} from "./codex-process-identity.ts";

const PROCESS_TERMINATION_GRACE_MILLISECONDS = 5_000;
const PROCESS_TERMINATION_POLL_MILLISECONDS = 50;
const WAIT_SIGNAL = new Int32Array(new SharedArrayBuffer(4));

function processGroupAbsent(error: unknown) {
  return (
    error instanceof Error && "code" in error && String(error.code) === "ESRCH"
  );
}

function waitForTrackedProcessGroupExit(isActive: () => boolean) {
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

function sameProcessIdentity(
  expected: {
    bootIdentity: string;
    namespaceIdentity: string;
    startIdentity: string;
  },
  actual: {
    bootIdentity: string;
    namespaceIdentity: string;
    startIdentity: string;
  },
) {
  return (
    expected.bootIdentity === actual.bootIdentity &&
    expected.namespaceIdentity === actual.namespaceIdentity &&
    expected.startIdentity === actual.startIdentity
  );
}

export function terminateTrackedCodexProcessGroup(
  tracked: {
    processGroupId: number;
    bootIdentity: string;
    namespaceIdentity: string;
    startIdentity: string;
  },
  {
    hasLiveProcessGroupMember = codexProcessGroupHasLiveMember,
    killProcessGroup = process.kill,
    readProcessIdentity = readCodexProcessIdentity,
    waitForExit = waitForTrackedProcessGroupExit,
  }: {
    hasLiveProcessGroupMember?: typeof codexProcessGroupHasLiveMember;
    killProcessGroup?: (
      processId: number,
      signal: NodeJS.Signals | 0,
    ) => unknown;
    readProcessIdentity?: typeof readCodexProcessIdentity;
    waitForExit?: (isActive: () => boolean) => boolean;
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
    if (terminationRequested) {
      try {
        return hasLiveProcessGroupMember(processGroupId);
      } catch (error) {
        throw new DurableCoreError(
          "codex_execution_process_group_termination_failed",
          "Tracked Codex process group could not be inspected",
          { cause: error },
        );
      }
    }
    try {
      killProcessGroup(target, 0);
    } catch (error) {
      if (processGroupAbsent(error)) {
        return false;
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
  if (!waitForExit(isActive)) {
    throw new DurableCoreError(
      "codex_execution_process_group_termination_failed",
      "Tracked Codex process group remained active after force termination",
    );
  }
  return "SIGKILL";
}
