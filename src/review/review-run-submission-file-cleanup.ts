import { randomUUID } from "node:crypto";
import {
  linkSync,
  lstatSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";

import { isMissingPath } from "./review-run-submission-files.ts";

function isExistingPath(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function matchesSnapshot(
  before: import("node:fs").Stats,
  after: import("node:fs").Stats,
) {
  return (
    before.birthtimeMs === after.birthtimeMs &&
    before.ctimeMs === after.ctimeMs &&
    before.dev === after.dev &&
    before.gid === after.gid &&
    before.ino === after.ino &&
    before.mode === after.mode &&
    before.mtimeMs === after.mtimeMs &&
    before.size === after.size &&
    before.uid === after.uid &&
    before.isDirectory() === after.isDirectory() &&
    before.isFile() === after.isFile() &&
    before.isSymbolicLink() === after.isSymbolicLink()
  );
}

function revalidateSnapshot(path: string, snapshot: import("node:fs").Stats) {
  try {
    const current = lstatSync(path);
    return matchesSnapshot(snapshot, current) ? current : null;
  } catch (error) {
    if (isMissingPath(error)) {
      return null;
    }
    throw error;
  }
}

function restoreQuarantinedArtifact(
  path: string,
  quarantinePath: string,
  current: import("node:fs").Stats,
) {
  if (!current.isSymbolicLink() && !current.isFile()) {
    const preservedPath = `${path}.cleanup-preserved-${randomUUID()}`;
    try {
      renameSync(quarantinePath, preservedPath);
    } catch (preserveError) {
      throw new Error(
        "Submission cleanup could not preserve a non-restorable artifact",
        { cause: preserveError },
      );
    }
    throw new TypeError(
      `Submission cleanup encountered a non-restorable artifact; preserved it at ${preservedPath}`,
    );
  }
  try {
    if (current.isSymbolicLink()) {
      symlinkSync(readlinkSync(quarantinePath), path);
    } else {
      linkSync(quarantinePath, path);
    }
  } catch (error) {
    if (!isExistingPath(error)) {
      throw error;
    }
    const preservedPath = `${path}.cleanup-preserved-${randomUUID()}`;
    try {
      renameSync(quarantinePath, preservedPath);
    } catch (preserveError) {
      throw new Error(
        "Submission cleanup could not preserve a concurrent artifact replacement",
        { cause: preserveError },
      );
    }
    throw new Error(
      `Submission cleanup encountered a concurrent artifact replacement; preserved the quarantined artifact at ${preservedPath}`,
      { cause: error },
    );
  }
  rmSync(quarantinePath, { force: true });
}

export function removeOwnedFile(
  path: string,
  expected: {
    dev: number;
    ino: number;
    birthtimeMs?: number;
    uid?: number;
    gid?: number;
    mode?: number;
  },
  operations: {
    beforeRename?: () => void;
    afterQuarantine?: (quarantinePath: string) => void;
  } = {},
): boolean {
  const quarantinePath = `${path}.cleanup-${randomUUID()}`;
  try {
    const status = lstatSync(path);
    if (
      status.dev !== expected.dev ||
      status.ino !== expected.ino ||
      (expected.birthtimeMs !== undefined &&
        status.birthtimeMs !== expected.birthtimeMs)
    ) {
      return false;
    }
    if (
      (expected.uid !== undefined && status.uid !== expected.uid) ||
      (expected.gid !== undefined && status.gid !== expected.gid) ||
      (expected.mode !== undefined && status.mode !== expected.mode)
    ) {
      throw new TypeError("Submission cleanup artifact metadata changed");
    }
  } catch (error) {
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
  operations.beforeRename?.();
  try {
    renameSync(path, quarantinePath);
  } catch (error) {
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
  const current = lstatSync(quarantinePath);
  operations.afterQuarantine?.(quarantinePath);
  if (revalidateSnapshot(quarantinePath, current) === null) {
    return false;
  }
  if (!current.isFile()) {
    restoreQuarantinedArtifact(path, quarantinePath, current);
    throw new TypeError("Submission cleanup encountered a non-file artifact");
  }
  if (
    current.dev !== expected.dev ||
    current.ino !== expected.ino ||
    (expected.birthtimeMs !== undefined &&
      current.birthtimeMs !== expected.birthtimeMs)
  ) {
    restoreQuarantinedArtifact(path, quarantinePath, current);
    return false;
  }
  if (
    (expected.uid !== undefined && current.uid !== expected.uid) ||
    (expected.gid !== undefined && current.gid !== expected.gid) ||
    (expected.mode !== undefined && current.mode !== expected.mode)
  ) {
    restoreQuarantinedArtifact(path, quarantinePath, current);
    throw new TypeError("Submission cleanup artifact metadata changed");
  }
  rmSync(quarantinePath, { force: true });
  return true;
}

export function removeOwnedDirectory(
  path: string,
  expected: {
    dev: number;
    ino: number;
    birthtimeMs: number;
    uid?: number;
    gid?: number;
  },
  operations: {
    beforeRename?: () => void;
    afterQuarantine?: (quarantinePath: string) => void;
  } = {},
): boolean {
  const quarantinePath = `${path}.cleanup-${randomUUID()}`;
  let status;
  try {
    status = lstatSync(path);
  } catch (error) {
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
  if (
    !status.isDirectory() ||
    status.isSymbolicLink() ||
    status.dev !== expected.dev ||
    status.ino !== expected.ino ||
    status.birthtimeMs !== expected.birthtimeMs ||
    (expected.uid !== undefined && status.uid !== expected.uid) ||
    (expected.gid !== undefined && status.gid !== expected.gid)
  ) {
    return false;
  }
  operations.beforeRename?.();
  try {
    renameSync(path, quarantinePath);
  } catch (error) {
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
  const quarantined = lstatSync(quarantinePath);
  operations.afterQuarantine?.(quarantinePath);
  if (revalidateSnapshot(quarantinePath, quarantined) === null) {
    return false;
  }
  if (
    !quarantined.isDirectory() ||
    quarantined.isSymbolicLink() ||
    quarantined.dev !== expected.dev ||
    quarantined.ino !== expected.ino ||
    quarantined.birthtimeMs !== expected.birthtimeMs ||
    (expected.uid !== undefined && quarantined.uid !== expected.uid) ||
    (expected.gid !== undefined && quarantined.gid !== expected.gid)
  ) {
    try {
      renameSync(quarantinePath, path);
    } catch (error) {
      if (!isExistingPath(error)) {
        throw error;
      }
      const preservedPath = `${path}.cleanup-preserved-${randomUUID()}`;
      renameSync(quarantinePath, preservedPath);
    }
    return false;
  }
  rmSync(quarantinePath, { force: true, recursive: true });
  return true;
}
