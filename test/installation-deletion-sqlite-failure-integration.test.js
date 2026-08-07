import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  BACKUPS_PATH,
  CHECKOUTS_PATH,
  CODEX_HOME_PATH,
  STATE_PATH,
} from "../src/installation-environment.js";
import { deleteStoppedInstallation } from "../src/installation-deletion.js";

/**
 * @param {string} root
 * @param {Array<[string, string]>} [calls]
 */
function mappedFilesystem(root, calls = []) {
  const paths = new Map([
    [STATE_PATH, join(root, "state")],
    [CODEX_HOME_PATH, join(root, "state", "codex-home")],
    [CHECKOUTS_PATH, join(root, "checkouts")],
    [BACKUPS_PATH, join(root, "backups")],
  ]);
  for (const path of paths.values()) {
    mkdirSync(path, { mode: 0o700, recursive: true });
  }
  /** @param {string} path */
  const map = (path) => {
    const exact = paths.get(path);
    if (exact) {
      return exact;
    }
    for (const [logicalRoot, actualRoot] of paths) {
      const prefix = `${logicalRoot}/`;
      if (path.startsWith(prefix)) {
        return join(actualRoot, path.slice(prefix.length));
      }
    }
    return join(root, path.slice(1));
  };
  return {
    /** @param {string} path */
    lstat(path) {
      calls.push(["lstat", path]);
      const status = lstatSync(map(path));
      return {
        gid: 10001,
        isDirectory: () => status.isDirectory(),
        isSymbolicLink: () => status.isSymbolicLink(),
        mode: status.mode,
        uid: 10001,
      };
    },
    /** @param {string} path */
    readdir(path) {
      calls.push(["readdir", path]);
      return readdirSync(map(path), { withFileTypes: true });
    },
    /** @param {string} path */
    remove(path) {
      calls.push(["remove", path]);
      return rmSync(map(path), { recursive: true });
    },
  };
}

test("a live SQLite installation lock blocks deletion before any owned path is read or removed", (context) => {
  const root = mkdtempSync(
    join(tmpdir(), "quality-bar-installation-deletion-sqlite-"),
  );
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const lockPath = join(root, "installation.lock");
  const holder = new DatabaseSync(lockPath);
  holder.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
  /** @type {Array<[string, string]>} */
  const calls = [];

  assert.throws(
    () =>
      deleteStoppedInstallation({
        createLock: () => new DatabaseSync(lockPath),
        filesystem: mappedFilesystem(root, calls),
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "installation_locked",
  );

  assert.deepEqual(calls, []);
  holder.close();
});

test("the stopped deletion keeps the shared lock sentinel after success", (context) => {
  const root = mkdtempSync(
    join(tmpdir(), "quality-bar-installation-deletion-lock-sentinel-"),
  );
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const lockPath = join(root, "installation.lock");

  deleteStoppedInstallation({
    createLock: () => new DatabaseSync(lockPath),
    filesystem: mappedFilesystem(root),
  });

  assert.equal(existsSync(lockPath), true);
});
