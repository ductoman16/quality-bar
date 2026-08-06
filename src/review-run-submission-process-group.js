import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_PROCESS_ID = 0x7fffffff;
const MAX_PROCESS_ANCESTRY = 64;

/** @param {number} pid */
function parentProcessId(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > MAX_PROCESS_ID) {
    return null;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closingParenthesis = stat.lastIndexOf(")");
    const fields = stat
      .slice(closingParenthesis + 1)
      .trim()
      .split(/\s+/);
    const parentId = Number(fields[1]);
    if (
      closingParenthesis >= 0 &&
      Number.isSafeInteger(parentId) &&
      parentId > 0
    ) {
      return parentId;
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      typeof error.code !== "string" ||
      !["EACCES", "ENOENT", "ENOTDIR", "EPERM"].includes(error.code)
    ) {
      throw error;
    }
  }
  try {
    const parentId = Number(
      execFileSync("/bin/ps", ["-o", "ppid=", "-p", String(pid)], {
        encoding: "utf8",
      }).trim(),
    );
    return Number.isSafeInteger(parentId) && parentId > 0 ? parentId : null;
  } catch {
    return null;
  }
}

/**
 * @param {number} pid
 * @param {number} ancestorPid
 * @param {(pid: number) => number | null} [readParent]
 */
export function isProcessDescendant(
  pid,
  ancestorPid,
  readParent = parentProcessId,
) {
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    pid > MAX_PROCESS_ID ||
    !Number.isSafeInteger(ancestorPid) ||
    ancestorPid <= 0 ||
    ancestorPid > MAX_PROCESS_ID
  ) {
    return false;
  }
  const visited = new Set();
  let current = pid;
  for (let depth = 0; depth < MAX_PROCESS_ANCESTRY; depth += 1) {
    if (current === ancestorPid) {
      return true;
    }
    if (visited.has(current)) {
      return false;
    }
    visited.add(current);
    const parent = readParent(current);
    if (
      typeof parent !== "number" ||
      !Number.isSafeInteger(parent) ||
      parent <= 1 ||
      parent > MAX_PROCESS_ID
    ) {
      return false;
    }
    current = parent;
  }
  return false;
}

/** @param {number} pid */
export function processGroupIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > MAX_PROCESS_ID) {
    return null;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closingParenthesis = stat.lastIndexOf(")");
    const fields = stat
      .slice(closingParenthesis + 1)
      .trim()
      .split(/\s+/);
    const groupId = Number(fields[2]);
    if (
      closingParenthesis >= 0 &&
      Number.isSafeInteger(groupId) &&
      groupId > 0
    ) {
      return groupId;
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      typeof error.code !== "string" ||
      !["EACCES", "ENOENT", "ENOTDIR", "EPERM"].includes(error.code)
    ) {
      throw error;
    }
  }
  try {
    const groupId = Number(
      execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(pid)], {
        encoding: "utf8",
      }).trim(),
    );
    return Number.isSafeInteger(groupId) && groupId > 0 ? groupId : null;
  } catch {
    return null;
  }
}

/**
 * @param {number} groupId
 * @param {{isProcessAlive(pid: number): boolean, processStartIdentity(pid: number): string | null}} dependencies
 */
export function bindTrustedProcessGroup(groupId, dependencies) {
  const leaderStartIdentity = dependencies.processStartIdentity(groupId);
  if (
    !Number.isSafeInteger(groupId) ||
    groupId < 1 ||
    !dependencies.isProcessAlive(groupId) ||
    processGroupIdentity(groupId) !== groupId ||
    leaderStartIdentity === null
  ) {
    throw new TypeError("Review Run submission process group is invalid");
  }
  return { groupId, leaderStartIdentity };
}

/** @param {{isProcessAlive(pid: number): boolean, processStartIdentity(pid: number): string | null, onBound: (binding: {groupId: number, leaderStartIdentity: string}) => void}} dependencies */
export function createTrustedProcessGroupBinding(dependencies) {
  /** @type {{groupId: number, leaderStartIdentity: string} | null} */
  let trusted = null;
  return {
    /** @param {number} groupId */
    bind(groupId) {
      if (trusted !== null) {
        throw new TypeError(
          "Review Run submission process group is already bound",
        );
      }
      trusted = bindTrustedProcessGroup(groupId, dependencies);
      dependencies.onBound(trusted);
    },
    current: () => trusted,
  };
}
