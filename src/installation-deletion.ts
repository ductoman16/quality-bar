import { lstatSync, readdirSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import {
  CODEX_HOME_PATH,
  INSTALLATION_LOCK_PATH,
  OWNED_INSTALLATION_PATHS,
  STATE_PATH,
  validateInstallationDeletion,
} from "./installation-environment.ts";

export const INSTALLATION_DELETION_PATHS = Object.freeze([
  CODEX_HOME_PATH,
  STATE_PATH,
  ...OWNED_INSTALLATION_PATHS.filter(
    (path) => path !== STATE_PATH && path !== CODEX_HOME_PATH,
  ),
]);

export class InstallationDeletionError extends Error {
  name: "InstallationDeletionError";
  code: string;
  path?: string;

  constructor(
    code: string,
    message: string,
    options?: ErrorOptions,
    path?: string,
  ) {
    super(message, options);
    this.name = "InstallationDeletionError";
    this.code = code;
    if (path !== undefined) {
      this.path = path;
    }
  }
}

export type DeletionFilesystem = {
  lstat: (path: string) => {
    gid: number;
    isDirectory: () => boolean;
    isSymbolicLink: () => boolean;
    mode: number;
    uid: number;
  };
  readdir: (path: string) => { name: string }[];
  remove: (path: string) => void;
};

function createFilesystem() {
  return {
    lstat: lstatSync,
    readdir(path: string) {
      return readdirSync(path, { withFileTypes: true });
    },
    remove(path: string) {
      rmSync(path, { recursive: true });
    },
  };
}

function errorDetail(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readFailure(path: string, cause: unknown): InstallationDeletionError {
  return new InstallationDeletionError(
    "installation_deletion_read_failed",
    `Owned installation path ${path} could not be read (${errorDetail(cause)})`,
    { cause },
    path,
  );
}

function removeFailure(
  path: string,
  cause: unknown,
): InstallationDeletionError {
  return new InstallationDeletionError(
    "installation_deletion_remove_failed",
    `Owned installation path ${path} could not be removed (${errorDetail(cause)})`,
    { cause },
    path,
  );
}

function childPath(path: string, name: string) {
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    isAbsolute(name) ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new InstallationDeletionError(
      "installation_deletion_path_unsafe",
      `Owned installation path ${path} contains an unsafe entry name`,
      undefined,
      path,
    );
  }
  return join(path, name);
}

function assertSafeRoot(filesystem: DeletionFilesystem, path: string) {
  let status;
  try {
    status = filesystem.lstat(path);
  } catch (cause) {
    throw readFailure(path, cause);
  }
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new InstallationDeletionError(
      "installation_deletion_path_unsafe",
      `Owned installation path ${path} is unsafe`,
      undefined,
      path,
    );
  }
}

function readChildren(filesystem: DeletionFilesystem, path: string) {
  assertSafeRoot(filesystem, path);
  let entries;
  try {
    entries = filesystem.readdir(path);
  } catch (cause) {
    throw readFailure(path, cause);
  }
  if (!Array.isArray(entries)) {
    throw new InstallationDeletionError(
      "installation_deletion_read_failed",
      `Owned installation path ${path} returned invalid entries`,
      undefined,
      path,
    );
  }
  return entries.map((entry) => {
    if (!entry || typeof entry.name !== "string") {
      throw new InstallationDeletionError(
        "installation_deletion_path_unsafe",
        `Owned installation path ${path} returned an invalid entry`,
        undefined,
        path,
      );
    }
    return childPath(path, entry.name);
  });
}

function isNestedOwnedPath(path: string, child: string) {
  return path === STATE_PATH && child === CODEX_HOME_PATH;
}

/**
 * The SQLite lock is an operational sentinel shared by service and one-shot
 * containers. It is deliberately retained so releasing the lock cannot race
 * a new owner creating a replacement pathname while deletion is finishing.
 */
function isPreservedOperationalPath(child: string) {
  return child === INSTALLATION_LOCK_PATH;
}

function collectDeletionTargets(
  filesystem: DeletionFilesystem,
): Map<string, string[]> {
  return new Map(
    INSTALLATION_DELETION_PATHS.map((path) => [
      path,
      readChildren(filesystem, path),
    ]),
  );
}

function removeDeletionTargets(
  filesystem: DeletionFilesystem,
  targets: Map<string, string[]>,
) {
  for (const [path, children] of targets) {
    for (const child of children) {
      if (isNestedOwnedPath(path, child) || isPreservedOperationalPath(child)) {
        continue;
      }
      try {
        filesystem.remove(child);
      } catch (cause) {
        throw removeFailure(child, cause);
      }
    }
  }

  for (const path of INSTALLATION_DELETION_PATHS) {
    const remaining = readChildren(filesystem, path).filter(
      (child) =>
        !isNestedOwnedPath(path, child) && !isPreservedOperationalPath(child),
    );
    if (remaining.length > 0) {
      throw new InstallationDeletionError(
        "installation_deletion_incomplete",
        `Owned installation path ${path} still contains undeleted entries`,
        undefined,
        path,
      );
    }
  }
}

function attachCleanupFailures(failure: unknown, cleanupFailures: unknown[]) {
  if (cleanupFailures.length === 0 || !(failure instanceof Error)) {
    return;
  }
  failure.cause = new AggregateError(
    [
      ...(failure.cause === undefined ? [] : [failure.cause]),
      ...cleanupFailures,
    ],
    "Installation deletion and lock cleanup both failed",
  );
}

function throwExactly(failure: unknown) {
  throw failure;
}

/**
 * Delete the complete installed data set after proving that the application
 * does not hold the installation lock. External configuration and key files
 * are intentionally outside this operation.
 */
export function deleteStoppedInstallation({
  createLock,
  filesystem = createFilesystem(),
  validateInstallation = validateInstallationDeletion,
}: {
  createLock?: (path: string) => {
    close: () => unknown;
    exec: (sql: string) => unknown;
  };
  filesystem?: DeletionFilesystem;
  validateInstallation?: typeof validateInstallationDeletion;
} = {}) {
  let releaseInstallationLock;
  let operationFailed = false;
  let primaryFailure: unknown;
  let result;

  try {
    ({ releaseInstallationLock } = validateInstallation({
      createLock,
      filesystem,
    }));
    const targets = collectDeletionTargets(filesystem);
    removeDeletionTargets(filesystem, targets);
    result = {
      status: "installation_deleted",
      paths: [...INSTALLATION_DELETION_PATHS],
    };
  } catch (error) {
    operationFailed = true;
    primaryFailure = error;
  }

  const cleanupFailures: unknown[] = [];
  try {
    releaseInstallationLock?.();
  } catch (error) {
    cleanupFailures.push(error);
  }

  if (operationFailed) {
    attachCleanupFailures(primaryFailure, cleanupFailures);
    throwExactly(primaryFailure);
  }
  if (cleanupFailures.length > 0) {
    const [cleanupFailure, ...additionalCleanupFailures] = cleanupFailures;
    attachCleanupFailures(cleanupFailure, additionalCleanupFailures);
    throwExactly(cleanupFailure);
  }
  return result;
}
