import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_PROCESS_ID = 0x7fffffff;

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

/** @param {{isProcessAlive(pid: number): boolean, processStartIdentity(pid: number): string | null, onBound(): void}} dependencies */
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
      dependencies.onBound();
    },
    current: () => trusted,
  };
}
