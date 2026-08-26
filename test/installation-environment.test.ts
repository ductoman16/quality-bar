import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import {
  BACKUPS_PATH,
  acquireInstallationLock,
  BUNDLED_CODEX_VERSION,
  BUNDLED_GIT_VERSION,
  CHECKOUTS_PATH,
  CODEX_HOME_PATH,
  InstallationEnvironmentError,
  REQUIRED_FREE_SPACE_BYTES,
  STATE_PATH,
  validateInstallationEnvironment,
  validateInstallationFilesystem,
  validateInstallationSources,
} from "../src/installation-environment.ts";

const ownedPaths = [STATE_PATH, CODEX_HOME_PATH, CHECKOUTS_PATH, BACKUPS_PATH];

export type FilesystemInput = {
  gid?: number;
  notDirectory?: boolean;
  notFile?: boolean;
  symbolicLink?: boolean;
  mode?: number;
  uid?: number;
  bavail?: number;
  filesystemType?: number;
};

export type ToolInput = {
  gitVersion?: string;
  codexVersion?: string;
  loginUnavailable?: boolean;
};

function createFilesystem(input: FilesystemInput = {}) {
  const locks: Set<string> = new Set();
  const syncedDescriptors: number[] = [];
  let descriptor = 0;
  return {
    close() {},
    createLock(path: string) {
      if (locks.has(path)) {
        throw new Error("already locked");
      }
      locks.add(path);
      return {
        close() {
          locks.delete(path);
        },
        exec() {},
      };
    },
    fsync(descriptor: number) {
      syncedDescriptors.push(descriptor);
    },
    lstat(path: string) {
      const isDirectory = ownedPaths.includes(path);
      return {
        gid: input.gid ?? 10001,
        isDirectory: () => isDirectory && !input.notDirectory,
        isFile: () => !isDirectory && !input.notFile,
        isSymbolicLink: () => Boolean(input.symbolicLink),
        mode: input.mode ?? (isDirectory ? 0o40700 : 0o100400),
        uid: input.uid ?? 10001,
      };
    },
    mkdtemp(prefix: string) {
      return `${prefix}test`;
    },
    open() {
      descriptor += 1;
      return descriptor;
    },
    remove() {},
    rename() {},
    statfs(path: string) {
      assert.ok(
        ownedPaths.includes(path) ||
          path === "/etc/quality-bar/config.env" ||
          path === "/run/secrets/quality-bar-master-key",
      );
      return {
        bavail: input.bavail ?? Math.ceil(REQUIRED_FREE_SPACE_BYTES / 1024),
        bsize: 1024,
        type: input.filesystemType ?? 0xef53,
      };
    },
    writeFile() {},
    syncedDescriptors,
  };
}

test("accepts Docker Desktop FUSE ownership without weakening native ownership", () => {
  assert.doesNotThrow(() =>
    validateInstallationSources({
      filesystem: createFilesystem({
        filesystemType: 0x65735546,
        gid: 0,
        uid: 0,
      }),
    }),
  );
  assert.throws(
    () =>
      validateInstallationSources({
        filesystem: createFilesystem({ gid: 0, uid: 0 }),
      }),
    (error) =>
      error instanceof InstallationEnvironmentError &&
      error.code === "owned_path_unsafe",
  );
});

function runTool(input: ToolInput = {}) {
  return (command: string, arguments_: string[]) => {
    if (command === "git" && arguments_[0] === "--version") {
      return input.gitVersion ?? `git version ${BUNDLED_GIT_VERSION}`;
    }
    if (command === "codex" && arguments_[0] === "--version") {
      return input.codexVersion ?? `codex-cli ${BUNDLED_CODEX_VERSION}`;
    }
    if (command === "codex" && arguments_.join(" ") === "login status") {
      if (input.loginUnavailable) {
        throw new Error("not logged in");
      }
      return "Logged in using ChatGPT";
    }
    throw new Error("unexpected tool invocation");
  };
}

test("validates the exact owned roots, bundled tools, persistent login, and exclusive installation lock", () => {
  const filesystem = createFilesystem();
  const first = validateInstallationEnvironment({
    createLock: filesystem.createLock,
    filesystem,
    runTool: runTool(),
  });

  assert.throws(
    () =>
      validateInstallationEnvironment({
        createLock: filesystem.createLock,
        filesystem,
        runTool: runTool(),
      }),
    (error) =>
      error instanceof InstallationEnvironmentError &&
      error.code === "installation_locked",
  );

  first.releaseInstallationLock();
  const second = validateInstallationEnvironment({
    createLock: filesystem.createLock,
    filesystem,
    runTool: runTool(),
  });
  second.releaseInstallationLock();
  assert.deepEqual(
    filesystem.syncedDescriptors,
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
});

test("holds a real SQLite exclusive installation lock until it is released", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-installation-lock-"),
  );
  const lockPath = join(directory, "installation.lock");
  const createLock = () => new DatabaseSync(lockPath);
  const first = acquireInstallationLock(createLock);

  const contender = spawnSync(
    process.execPath,
    [
      join(
        import.meta.dirname,
        "../fixtures/test-probes/sqlite-lock-contender.mjs",
      ),
      lockPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(contender.status, 0, contender.stderr);

  first();
  const second = acquireInstallationLock(createLock);
  second();
  rmSync(directory, { force: true, recursive: true });
});

test("startup enforces the configured reserve on state and checkout filesystems", () => {
  const filesystem = createFilesystem({ bavail: 6 * 1024 ** 2 });

  assert.throws(
    () =>
      validateInstallationFilesystem({
        createLock: filesystem.createLock,
        filesystem,
        reserveBytes: 7 * 1024 ** 3,
      }),
    (error) =>
      error instanceof InstallationEnvironmentError &&
      error.code === "storage_reserve_unavailable" &&
      (error as any).filesystem === "state" &&
      (error as any).path === "/var/lib/quality-bar" &&
      (error as any).available_bytes === 6 * 1024 ** 3 &&
      (error as any).reserve_bytes === 7 * 1024 ** 3,
  );
});

for (const [name, input, code] of [
  [
    "a root with group-readable permissions",
    { mode: 0o40750 },
    "owned_path_unsafe",
  ],
  [
    "a read-only source with group-readable permissions",
    { mode: 0o100440 },
    "owned_path_unsafe",
  ],
  [
    "a network filesystem",
    { filesystemType: 0x6969 },
    "filesystem_unsupported",
  ],
  [
    "a filesystem below the 5 GiB reserve",
    { bavail: 1 },
    "storage_reserve_unavailable",
  ],
  [
    "the wrong bundled Git version",
    { gitVersion: "git version 2.53.0" },
    "git_version_unsupported",
  ],
  [
    "the wrong bundled Codex version",
    { codexVersion: "codex-cli 0.144.5" },
    "codex_version_unsupported",
  ],
  [
    "an unavailable persistent Codex login",
    { loginUnavailable: true },
    "codex_authentication_unavailable",
  ],
] as [string, FilesystemInput & ToolInput, string][]) {
  test(`rejects ${name} with its owning error`, () => {
    const filesystem = createFilesystem(input);
    assert.throws(
      () =>
        validateInstallationEnvironment({
          createLock: filesystem.createLock,
          filesystem,
          runTool: runTool(input),
        }),
      (error) =>
        error instanceof InstallationEnvironmentError && error.code === code,
    );
  });
}
