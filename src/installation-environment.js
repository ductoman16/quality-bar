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
  MASTER_KEY_PATH,
} from "./installation-configuration.js";

export const SERVICE_UID = 10001;
export const SERVICE_GID = 10001;
export const STATE_PATH = "/var/lib/quality-bar";
export const CODEX_HOME_PATH = `${STATE_PATH}/codex-home`;
export const CHECKOUTS_PATH = "/var/cache/quality-bar/checkouts";
export const BACKUPS_PATH = "/var/backups/quality-bar";
export const INSTALLATION_LOCK_PATH = `${STATE_PATH}/installation.lock`;
export const REQUIRED_FREE_SPACE_BYTES = 5 * 1024 ** 3;
export const BUNDLED_GIT_VERSION = "2.54.0";
export const BUNDLED_CODEX_VERSION = "0.145.0";

const LOCAL_FILESYSTEM_TYPES = new Set([
  0xef53, // ext
  0x58465342, // XFS
  0x794c7630, // overlay
  0x9123683e, // Btrfs
  0x2fc12fc1, // ZFS
]);

export class InstallationEnvironmentError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "InstallationEnvironmentError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new InstallationEnvironmentError(code, message, { cause });
}

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
  if (
    status.uid !== SERVICE_UID ||
    status.gid !== SERVICE_GID ||
    (status.mode & 0o777) !== 0o400
  ) {
    fail(
      "owned_path_unsafe",
      "A required owned path has unsafe ownership or permissions",
    );
  }
}

function validateFilesystem(filesystem, path, requireReserve) {
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
  if (
    requireReserve &&
    BigInt(facts.bsize) * BigInt(facts.bavail) <
      BigInt(REQUIRED_FREE_SPACE_BYTES)
  ) {
    fail(
      "storage_reserve_unavailable",
      "A required filesystem is below the free-space reserve",
    );
  }
}

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
      `A required filesystem lacks durable local-write semantics (${error?.code ?? "unknown"})`,
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

export function acquireInstallationLock(createLock) {
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
    remove(path) {
      rmSync(path, { force: true, recursive: true });
    },
    rename: renameSync,
    statfs: statfsSync,
    writeFile: writeFileSync,
  };
}

function createInstallationLock(path) {
  return new DatabaseSync(path);
}

function runBundledTool(command, arguments_) {
  return execFileSync(command, arguments_, { encoding: "utf8" }).trim();
}

export function validateInstallationSources({
  filesystem = createFilesystem(),
} = {}) {
  for (const path of [CONFIGURATION_PATH, MASTER_KEY_PATH]) {
    validateOwnedReadOnlyFile(filesystem, path);
  }
}

export function validateInstallationFilesystem({
  createLock = createInstallationLock,
  filesystem = createFilesystem(),
} = {}) {
  for (const path of [
    STATE_PATH,
    CODEX_HOME_PATH,
    CHECKOUTS_PATH,
    BACKUPS_PATH,
  ]) {
    validateOwnedDirectory(filesystem, path);
  }
  validateInstallationSources({ filesystem });
  const releaseInstallationLock = acquireInstallationLock(createLock);
  try {
    for (const [path, requireReserve] of [
      [STATE_PATH, true],
      [CHECKOUTS_PATH, true],
      [BACKUPS_PATH, false],
    ]) {
      validateFilesystem(filesystem, path, requireReserve);
      validateDurableWriteSemantics(filesystem, path);
    }
  } catch (error) {
    releaseInstallationLock();
    throw error;
  }
  return { releaseInstallationLock };
}

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

export function validateBundledToolsAndCodexLogin({
  runTool = runBundledTool,
} = {}) {
  validateBundledTools({ runTool });
  validateCodexLogin({ runTool });
}

export function validateInstallationEnvironment({
  createLock = createInstallationLock,
  filesystem = createFilesystem(),
  runTool = runBundledTool,
} = {}) {
  const installation = validateInstallationFilesystem({
    createLock,
    filesystem,
  });
  try {
    validateBundledToolsAndCodexLogin({ runTool });
    return installation;
  } catch (error) {
    installation.releaseInstallationLock();
    throw error;
  }
}
