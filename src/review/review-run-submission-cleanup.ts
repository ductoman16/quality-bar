import { randomUUID } from "node:crypto";
import { lstatSync, renameSync, rmdirSync, rmSync } from "node:fs";

import { isMissingPath } from "./review-run-submission-files.ts";

function pathExists(path: string) {
  try {
    return lstatSync(path).isFile();
  } catch (error) {
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
}

export function removeSubmissionDirectory(
  path: string,
  options: { force: boolean; recursive: boolean },
) {
  if (options.recursive) {
    rmSync(path, options);
    return;
  }
  try {
    rmdirSync(path);
  } catch (error) {
    if (
      !(
        options.force &&
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      throw error;
    }
  }
}

export function hasSubmissionArtifacts(paths: {
  requestPath: string;
  lockPath: string;
  responsePath: string;
  acknowledgmentPath: string;
  closedPath: string;
}) {
  return [
    paths.requestPath,
    paths.lockPath,
    paths.responsePath,
    paths.acknowledgmentPath,
  ].some(pathExists);
}

function hasOwnedSubmissionArtifacts(
  paths: {
    requestPath: string;
    lockPath: string;
    responsePath: string;
    acknowledgmentPath: string;
    closedPath: string;
  },
  identities: {
    requestIdentity: { dev: number; ino: number } | null;
    lockIdentity: { dev: number; ino: number } | null;
    responseIdentity: { dev: number; ino: number } | null;
    acknowledgmentIdentity: { dev: number; ino: number } | null;
  },
) {
  const artifacts: [string, { dev: number; ino: number } | null][] = [
    [paths.requestPath, identities.requestIdentity],
    [paths.lockPath, identities.lockIdentity],
    [paths.responsePath, identities.responseIdentity],
    [paths.acknowledgmentPath, identities.acknowledgmentIdentity],
  ];
  return artifacts.some(
    ([path, identity]) => identity !== null && pathExists(path),
  );
}

export function preserveCleanupFailure(
  failure: unknown,
  cleanupFailure: unknown,
) {
  if (failure instanceof Error) {
    Object.defineProperty(failure, "submissionCleanupFailure", {
      configurable: true,
      enumerable: false,
      value: cleanupFailure,
    });
  }
}

function normalizeCleanupFailure(failure: unknown) {
  return failure instanceof Error
    ? failure
    : new TypeError("Review Run submission cleanup failed", {
        cause: failure,
      });
}

export function mergeCleanupFailure(
  closeFailure: unknown,
  cleanupFailure: unknown,
): unknown {
  const normalizedCleanupFailure = normalizeCleanupFailure(cleanupFailure);
  if (closeFailure !== null) {
    const normalizedCloseFailure = normalizeCleanupFailure(closeFailure);
    preserveCleanupFailure(normalizedCloseFailure, normalizedCleanupFailure);
    return normalizedCloseFailure;
  }
  return normalizedCleanupFailure;
}

export function cleanupOwnedFile(
  path: string,
  identity: { dev: number; ino: number } | null,
  closeFailure: unknown,
  removeOwnedFile: (
    path: string,
    identity: { dev: number; ino: number },
  ) => void,
): unknown {
  if (!identity) {
    return closeFailure;
  }
  try {
    removeOwnedFile(path, identity);
    return closeFailure;
  } catch (cleanupFailure) {
    return mergeCleanupFailure(closeFailure, cleanupFailure);
  }
}

export function cleanupOwnedDirectory(
  path: string,
  identity: {
    dev: number;
    ino: number;
    birthtimeMs: number;
    uid: number;
    gid: number;
  },
  closeFailure: unknown,
  removeDirectory: (
    path: string,
    options: { force: boolean; recursive: boolean },
  ) => void,
): unknown {
  let status;
  try {
    status = lstatSync(path);
  } catch (error) {
    if (isMissingPath(error)) {
      return closeFailure;
    }
    return mergeCleanupFailure(closeFailure, error);
  }
  if (
    !status.isDirectory() ||
    status.isSymbolicLink() ||
    status.dev !== identity.dev ||
    status.ino !== identity.ino ||
    status.birthtimeMs !== identity.birthtimeMs ||
    status.uid !== identity.uid ||
    status.gid !== identity.gid
  ) {
    return mergeCleanupFailure(
      closeFailure,
      new TypeError(
        "Review Run submission command directory ownership changed",
      ),
    );
  }
  const quarantinePath = `${path}.cleanup-${randomUUID()}`;
  try {
    renameSync(path, quarantinePath);
    const quarantined = lstatSync(quarantinePath);
    if (
      !quarantined.isDirectory() ||
      quarantined.isSymbolicLink() ||
      quarantined.dev !== identity.dev ||
      quarantined.ino !== identity.ino ||
      quarantined.birthtimeMs !== identity.birthtimeMs ||
      quarantined.uid !== identity.uid ||
      quarantined.gid !== identity.gid
    ) {
      try {
        renameSync(quarantinePath, path);
      } catch (restoreFailure) {
        return mergeCleanupFailure(closeFailure, restoreFailure);
      }
      return mergeCleanupFailure(
        closeFailure,
        new TypeError(
          "Review Run submission command directory ownership changed",
        ),
      );
    }
    try {
      removeDirectory(quarantinePath, { force: true, recursive: false });
      try {
        lstatSync(quarantinePath);
        renameSync(quarantinePath, path);
        throw new Error(
          "Review Run submission command directory was not removed",
        );
      } catch (verificationFailure) {
        if (!isMissingPath(verificationFailure)) {
          throw verificationFailure;
        }
      }
    } catch (removeFailure) {
      try {
        renameSync(quarantinePath, path);
      } catch (restoreFailure) {
        preserveCleanupFailure(removeFailure, restoreFailure);
      }
      throw removeFailure;
    }
    return closeFailure;
  } catch (cleanupFailure) {
    return mergeCleanupFailure(closeFailure, cleanupFailure);
  }
}

export function cleanupSubmissionFiles(
  paths: {
    requestPath: string;
    lockPath: string;
    responsePath: string;
    acknowledgmentPath: string;
    closedPath: string;
  },
  identities: {
    requestIdentity: { dev: number; ino: number } | null;
    lockIdentity: { dev: number; ino: number } | null;
    responseIdentity: { dev: number; ino: number } | null;
    acknowledgmentIdentity: { dev: number; ino: number } | null;
    closedIdentity: { dev: number; ino: number } | null;
  },
  closeFailure: unknown,
  removeOwnedFile: (
    path: string,
    identity: { dev: number; ino: number },
  ) => void,
) {
  const files: [string, { dev: number; ino: number } | null][] = [
    [paths.requestPath, identities.requestIdentity],
    [paths.lockPath, identities.lockIdentity],
    [paths.responsePath, identities.responseIdentity],
    [paths.acknowledgmentPath, identities.acknowledgmentIdentity],
    [paths.closedPath, identities.closedIdentity],
  ];
  return files.reduce(
    (failure, [path, identity]) =>
      cleanupOwnedFile(path, identity, failure, removeOwnedFile),
    closeFailure,
  );
}

export async function drainSubmissionArtifacts(
  paths: {
    requestPath: string;
    lockPath: string;
    responsePath: string;
    acknowledgmentPath: string;
    closedPath: string;
  },
  identities: {
    requestIdentity: { dev: number; ino: number } | null;
    lockIdentity: { dev: number; ino: number } | null;
    responseIdentity: { dev: number; ino: number } | null;
    acknowledgmentIdentity: { dev: number; ino: number } | null;
    closedIdentity: { dev: number; ino: number } | null;
  },
  closeFailure: unknown,
  removeOwnedFile: (
    path: string,
    identity: { dev: number; ino: number },
  ) => void,
  attempts: number = 100,
): Promise<{ drained: boolean; failure: unknown }> {
  let failure = closeFailure;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    failure = cleanupOwnedSubmissionFiles(
      paths,
      identities,
      failure,
      removeOwnedFile,
    );
    if (!hasOwnedSubmissionArtifacts(paths, identities)) {
      return { drained: true, failure };
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return {
    drained: !hasOwnedSubmissionArtifacts(paths, identities),
    failure,
  };
}

function cleanupOwnedSubmissionFiles(
  paths: {
    requestPath: string;
    lockPath: string;
    responsePath: string;
    acknowledgmentPath: string;
    closedPath: string;
  },
  identities: {
    requestIdentity: { dev: number; ino: number } | null;
    lockIdentity: { dev: number; ino: number } | null;
    responseIdentity: { dev: number; ino: number } | null;
    acknowledgmentIdentity: { dev: number; ino: number } | null;
    closedIdentity: { dev: number; ino: number } | null;
  },
  closeFailure: unknown,
  removeOwnedFile: (
    path: string,
    identity: { dev: number; ino: number },
  ) => void,
) {
  const files: [string, { dev: number; ino: number } | null][] = [
    [paths.requestPath, identities.requestIdentity],
    [paths.lockPath, identities.lockIdentity],
    [paths.responsePath, identities.responseIdentity],
    [paths.acknowledgmentPath, identities.acknowledgmentIdentity],
  ];
  return files.reduce(
    (failure, [path, identity]) =>
      cleanupOwnedFile(path, identity, failure, removeOwnedFile),
    closeFailure,
  );
}
