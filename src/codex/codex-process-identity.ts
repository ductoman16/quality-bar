import { execFileSync } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";

function requireIdentity(value: unknown, message: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(message);
  }
  return value.trim();
}

function readLinuxProcessIdentity(processId: number) {
  const stat = readFileSync(`/proc/${processId}/stat`, "utf8");
  const commandEnd = stat.lastIndexOf(")");
  const fields = stat
    .slice(commandEnd + 2)
    .trim()
    .split(/\s+/);
  return {
    bootIdentity: requireIdentity(
      readFileSync("/proc/sys/kernel/random/boot_id", "utf8"),
      "Codex process boot identity is unavailable",
    ),
    namespaceIdentity: requireIdentity(
      readlinkSync("/proc/self/ns/pid"),
      "Codex process namespace identity is unavailable",
    ),
    startIdentity: requireIdentity(
      fields[19],
      "Codex process start identity is unavailable",
    ),
  };
}

function readDarwinProcessIdentity(processId: number) {
  return {
    bootIdentity: requireIdentity(
      execFileSync("/usr/sbin/sysctl", ["-n", "kern.boottime"], {
        encoding: "utf8",
      }),
      "Codex process boot identity is unavailable",
    ),
    namespaceIdentity: "darwin-global",
    startIdentity: requireIdentity(
      execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(processId)], {
        encoding: "utf8",
      }),
      "Codex process start identity is unavailable",
    ),
  };
}

export function readCodexProcessIdentity(processId: number) {
  if (!Number.isSafeInteger(processId) || processId < 1) {
    throw new TypeError("Codex process identity target is invalid");
  }
  if (process.platform === "linux") {
    return readLinuxProcessIdentity(processId);
  }
  if (process.platform === "darwin") {
    return readDarwinProcessIdentity(processId);
  }
  throw new TypeError("Codex process identity platform is unsupported");
}

export function codexProcessGroupHasLiveMember(processGroupId: number) {
  if (!Number.isSafeInteger(processGroupId) || processGroupId < 1) {
    throw new TypeError("Codex process group identity is invalid");
  }
  const listing = execFileSync("/bin/ps", ["-axo", "pgid=,stat="], {
    encoding: "utf8",
  });
  for (const line of listing.trim().split("\n")) {
    const match = /^\s*(\d+)\s+(\S+)\s*$/.exec(line);
    if (match === null) {
      throw new TypeError("Codex process group inspection is invalid");
    }
    if (
      Number.parseInt(match[1], 10) === processGroupId &&
      !match[2].startsWith("Z")
    ) {
      return true;
    }
  }
  return false;
}

export function requireCodexProcessIdentity(candidate: unknown) {
  const identity = candidate as any;
  return {
    bootIdentity: requireIdentity(
      identity?.bootIdentity,
      "Codex process boot identity is invalid",
    ),
    namespaceIdentity: requireIdentity(
      identity?.namespaceIdentity,
      "Codex process namespace identity is invalid",
    ),
    startIdentity: requireIdentity(
      identity?.startIdentity,
      "Codex process start identity is invalid",
    ),
  };
}
