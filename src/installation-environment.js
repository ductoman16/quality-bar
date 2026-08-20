import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  CONFIGURATION_PATH,
  DEFAULT_FREE_SPACE_RESERVE_BYTES,
  MASTER_KEY_PATH,
} from "./installation-configuration.js";

export const SERVICE_UID = 10001;
export const SERVICE_GID = 10001;
export const STATE_PATH = "/var/lib/quality-bar";
export const CODEX_HOME_PATH = `${STATE_PATH}/codex-home`;
export const CHECKOUTS_PATH = "/var/cache/quality-bar/checkouts";
export const BACKUPS_PATH = "/var/backups/quality-bar";
export const OWNED_INSTALLATION_PATHS = Object.freeze([
  STATE_PATH,
  CODEX_HOME_PATH,
  CHECKOUTS_PATH,
  BACKUPS_PATH,
]);
export const INSTALLATION_LOCK_PATH = `${STATE_PATH}/installation.lock`;
export const REQUIRED_FREE_SPACE_BYTES = DEFAULT_FREE_SPACE_RESERVE_BYTES;
export const BUNDLED_GIT_VERSION = "2.54.0";
export const BUNDLED_CODEX_VERSION = "0.145.0";

const LOCAL_FILESYSTEM_TYPES = new Set([
  0xef53, // ext
  0x58465342, // XFS
  0x794c7630, // overlay
  0x9123683e, // Btrfs
  0x2fc12fc1, // ZFS
]);
const FUSE_SUPER_MAGIC = 0x65735546;

/**
 * @typedef {{
 *   close: (descriptor: number) => void,
 *   fsync: (descriptor: number) => void,
 *   lstat: (path: string) => {
 *     gid: number,
 *     isDirectory: () => boolean,
 *     isFile: () => boolean,
 *     isSymbolicLink: () => boolean,
 *     mode: number,
 *     uid: number,
 *   },
 *   mkdtemp: (prefix: string) => string,
 *   open: (path: string, flags: string, mode?: number) => number,
 *   remove: (path: string) => void,
 *   rename: (oldPath: string, newPath: string) => void,
 *   statfs: (path: string) => {bavail: number, bsize: number, type: number},
 *   writeFile: (descriptor: number, data: string) => void,
 * }} InstallationFilesystem
 */
/** @typedef {{close: () => unknown, exec: (sql: string) => unknown}} InstallationLock */
/**
 * @typedef {{
 *   lstat: (path: string) => {
 *     gid: number,
 *     isDirectory: () => boolean,
 *     isSymbolicLink: () => boolean,
 *     mode: number,
 *     uid: number,
 *   },
 * }} OwnedDirectoryFilesystem
 */

export class InstallationEnvironmentError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "InstallationEnvironmentError";
    this.code = code;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {never}
 */
function fail(code, message, cause) {
  throw new InstallationEnvironmentError(code, message, { cause });
}

/**
 * @param {OwnedDirectoryFilesystem} filesystem
 * @param {string} path
 */
function validateOwnedDirectory(filesystem, path) {
  let status;
  try {
    status = filesystem.lstat(path);
  } catch (error) {
    fail("owned_path_missing", "A required owned path is unavailable", error);
  }
  if (!status.isDirectory() || status.isSymbolicLink()) {
    fail("owned_path_unsafe", "A required owned path is unsafe");
  }
  if (
    status.uid !== SERVICE_UID ||
    status.gid !== SERVICE_GID ||
    (status.mode & 0o777) !== 0o700
  ) {
    fail(
      "owned_path_unsafe",
      "A required owned path has unsafe ownership or permissions",
    );
  }
}

/**
 * @param {InstallationFilesystem} filesystem
 * @param {string} path
 */
function validateOwnedReadOnlyFile(filesystem, path) {
  let status;
  try {
    status = filesystem.lstat(path);
  } catch (error) {
    fail("owned_path_missing", "A required owned path is unavailable", error);
  }
  if (!status.isFile() || status.isSymbolicLink()) {
    fail("owned_path_unsafe", "A required owned path is unsafe");
  }
  let safeOwner = status.uid === SERVICE_UID && status.gid === SERVICE_GID;
  if (!safeOwner && status.uid === 0 && status.gid === 0) {
    try {
      safeOwner = filesystem.statfs(path).type === FUSE_SUPER_MAGIC;
    } catch {
      // Fail closed below.
    }
  }
  if (!safeOwner || (status.mode & 0o777) !== 0o400) {
    fail(
      "owned_path_unsafe",
      "A required owned path has unsafe ownership or permissions",
    );
  }
}

/**
 * @param {InstallationFilesystem} filesystem
 * @param {string} path
 * @param {number | null} reserveBytes
 */
function validateFilesystem(filesystem, path, reserveBytes) {
  let facts;
  try {
    facts = filesystem.statfs(path);
  } catch (error) {
    fail(
      "filesystem_unavailable",
      "A required filesystem is unavailable",
      error,
    );
  }
  if (
    !Number.isInteger(facts.type) ||
    !Number.isInteger(facts.bsize) ||
    !Number.isInteger(facts.bavail) ||
    facts.bsize <= 0 ||
    facts.bavail < 0
  ) {
    fail(
      "filesystem_unsupported",
      "A required filesystem has unsupported semantics",
    );
  }
  if (!LOCAL_FILESYSTEM_TYPES.has(facts.type)) {
    fail("filesystem_unsupported", "A required filesystem is not local");
  }
  if (reserveBytes !== null) {
    const available = BigInt(facts.bsize) * BigInt(facts.bavail);
    if (available > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail(
        "filesystem_unsupported",
        "A required filesystem has unsupported free-space facts",
      );
    }
    const availableBytes = Number(available);
    if (availableBytes >= reserveBytes) {
      return;
    }
    const filesystem = path === STATE_PATH ? "state" : "checkouts";
    throw Object.assign(
      new InstallationEnvironmentError(
        "storage_reserve_unavailable",
        `The ${filesystem} filesystem at ${path} has ${availableBytes} bytes available with ${reserveBytes} bytes reserved`,
      ),
      {
        available_bytes: availableBytes,
        filesystem,
        path,
        reserve_bytes: reserveBytes,
      },
    );
  }
}

/**
 * @param {InstallationFilesystem} filesystem
 * @param {string} path
 */
function validateDurableWriteSemantics(filesystem, path) {
  let probePath;
  let directoryDescriptor;
  let fileDescriptor;
  try {
    probePath = filesystem.mkdtemp(`${path}/.quality-bar-filesystem-probe-`);
    const temporaryPath = `${probePath}/temporary`;
    const committedPath = `${probePath}/committed`;
    fileDescriptor = filesystem.open(temporaryPath, "wx", 0o600);
    filesystem.writeFile(fileDescriptor, "quality-bar");
    filesystem.fsync(fileDescriptor);
    filesystem.close(fileDescriptor);
    fileDescriptor = undefined;
    filesystem.rename(temporaryPath, committedPath);
    directoryDescriptor = filesystem.open(probePath, "r");
    filesystem.fsync(directoryDescriptor);
    filesystem.close(directoryDescriptor);
    directoryDescriptor = undefined;
  } catch (error) {
    fail(
      "filesystem_unsupported",
      `A required filesystem lacks durable local-write semantics (${
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "unknown"
      })`,
      error,
    );
  } finally {
    if (fileDescriptor !== undefined) {
      filesystem.close(fileDescriptor);
    }
    if (directoryDescriptor !== undefined) {
      filesystem.close(directoryDescriptor);
    }
    if (probePath) {
      filesystem.remove(probePath);
    }
  }
}

/**
 * @typedef {(command: string, arguments_: string[]) => string} ToolRunner
 */
/**
 * @param {ToolRunner} runTool
 * @param {string} command
 * @param {string[]} arguments_
 * @param {string} expected
 * @param {string} failureCode
 */
function validateTool(runTool, command, arguments_, expected, failureCode) {
  let output;
  try {
    output = runTool(command, arguments_);
  } catch (error) {
    fail(failureCode, "A required bundled tool is unavailable", error);
  }
  if (output !== expected) {
    fail(failureCode, "A required bundled tool has an unsupported version");
  }
}

/** @param {{ runTool?: ToolRunner }} [options] */
export function validateCodexLogin({ runTool = runBundledTool } = {}) {
  try {
    runTool("codex", ["login", "status"]);
  } catch (error) {
    fail(
      "codex_authentication_unavailable",
      "Persistent Codex authentication is unavailable",
      error,
    );
  }
}

/** @param {(path: string) => InstallationLock} createLock */
export function acquireInstallationLock(createLock) {
  /** @type {InstallationLock | undefined} */
  let lock;
  try {
    lock = createLock(INSTALLATION_LOCK_PATH);
    lock.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
  } catch (error) {
    lock?.close();
    fail(
      "installation_locked",
      "Another installation owner already holds the installation lock",
      error,
    );
  }

  if (!lock) {
    fail("installation_locked", "Installation lock is unavailable");
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    lock.close();
  };
}

function createFilesystem() {
  return {
    close: closeSync,
    fsync: fsyncSync,
    lstat: lstatSync,
    mkdtemp: mkdtempSync,
    open: openSync,
    /** @param {string} path */
    remove(path) {
      rmSync(path, { force: true, recursive: true });
    },
    rename: renameSync,
    statfs: statfsSync,
    writeFile: writeFileSync,
  };
}

/** @param {string} path */
function createInstallationLock(path) {
  return new DatabaseSync(path);
}

/**
 * @param {string} command
 * @param {string[]} arguments_
 */
function runBundledTool(command, arguments_) {
  return execFileSync(command, arguments_, { encoding: "utf8" }).trim();
}

/** @param {{ filesystem?: InstallationFilesystem }} [options] */
export function validateInstallationSources({
  filesystem = createFilesystem(),
} = {}) {
  for (const path of [CONFIGURATION_PATH, MASTER_KEY_PATH]) {
    validateOwnedReadOnlyFile(filesystem, path);
  }
}

/**
 * @param {{
 *   createLock?: (path: string) => InstallationLock,
 *   filesystem?: InstallationFilesystem,
 *   reserveBytes?: number
 * }} [options]
 */
export function validateInstallationFilesystem({
  createLock = createInstallationLock,
  filesystem = createFilesystem(),
  reserveBytes = REQUIRED_FREE_SPACE_BYTES,
} = {}) {
  if (!Number.isSafeInteger(reserveBytes) || reserveBytes <= 0) {
    throw new TypeError("free-space reserve is invalid");
  }
  for (const path of OWNED_INSTALLATION_PATHS) {
    validateOwnedDirectory(filesystem, path);
  }
  validateInstallationSources({ filesystem });
  const releaseInstallationLock = acquireInstallationLock(createLock);
  try {
    for (const [
      path,
      filesystemReserve,
    ] of /** @type {Array<[string, number | null]>} */ ([
      [STATE_PATH, reserveBytes],
      [CHECKOUTS_PATH, reserveBytes],
      [BACKUPS_PATH, null],
    ])) {
      validateFilesystem(filesystem, path, filesystemReserve);
      validateDurableWriteSemantics(filesystem, path);
    }
  } catch (error) {
    releaseInstallationLock();
    throw error;
  }
  return { releaseInstallationLock };
}

/**
 * Validate the exact owned roots before a stopped-installation deletion.
 * Deletion deliberately does not require a storage reserve, bundled tools, or
 * the operator's external configuration and master-key files.
 *
 * @param {{
 *   createLock?: (path: string) => InstallationLock,
 *   filesystem?: OwnedDirectoryFilesystem,
 * }} [options]
 */
export function validateInstallationDeletion({
  createLock = createInstallationLock,
  filesystem = createFilesystem(),
} = {}) {
  const releaseInstallationLock = acquireInstallationLock(createLock);
  try {
    for (const path of OWNED_INSTALLATION_PATHS) {
      validateOwnedDirectory(filesystem, path);
    }
  } catch (error) {
    releaseInstallationLock();
    throw error;
  }
  return { releaseInstallationLock };
}

/** @param {{ runTool?: ToolRunner }} [options] */
export function validateBundledTools({ runTool = runBundledTool } = {}) {
  validateTool(
    runTool,
    "git",
    ["--version"],
    `git version ${BUNDLED_GIT_VERSION}`,
    "git_version_unsupported",
  );
  validateTool(
    runTool,
    "codex",
    ["--version"],
    `codex-cli ${BUNDLED_CODEX_VERSION}`,
    "codex_version_unsupported",
  );
}

/** @param {{ runTool?: ToolRunner }} [options] */
export function validateBundledToolsAndCodexLogin({
  runTool = runBundledTool,
} = {}) {
  validateBundledTools({ runTool });
  validateCodexLogin({ runTool });
}

/**
 * @param {{
 *   createLock?: (path: string) => InstallationLock,
 *   filesystem?: InstallationFilesystem,
 *   reserveBytes?: number,
 *   runTool?: ToolRunner
 * }} [options]
 */
export function validateInstallationEnvironment({
  createLock = createInstallationLock,
  filesystem = createFilesystem(),
  reserveBytes = REQUIRED_FREE_SPACE_BYTES,
  runTool = runBundledTool,
} = {}) {
  const installation = validateInstallationFilesystem({
    createLock,
    filesystem,
    reserveBytes,
  });
  try {
    validateBundledToolsAndCodexLogin({ runTool });
    return installation;
  } catch (error) {
    installation.releaseInstallationLock();
    throw error;
  }
}
