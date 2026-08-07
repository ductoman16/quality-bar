import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

/** @param {string} root */
function mappedFilesystem(root) {
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
    readdir: (path) => readdirSync(map(path), { withFileTypes: true }),
    /** @param {string} path */
    remove: (path) => rmSync(map(path), { force: true, recursive: true }),
  };
}

test("deletion removes an owned symlink without following it to an external file", (context) => {
  const root = mkdtempSync(
    join(tmpdir(), "quality-bar-installation-deletion-security-"),
  );
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const filesystem = mappedFilesystem(root);
  const outside = join(root, "operator-managed-copy");
  writeFileSync(outside, "must remain");
  const checkoutRoot = join(root, "checkouts");
  symlinkSync(outside, join(checkoutRoot, "operator-link"));

  deleteStoppedInstallation({
    createLock: () => ({ close() {}, exec() {} }),
    filesystem,
  });

  assert.equal(existsSync(outside), true);
  assert.equal(existsSync(join(checkoutRoot, "operator-link")), false);
});

test("a symlinked owned root is rejected before deletion", (context) => {
  const root = mkdtempSync(
    join(tmpdir(), "quality-bar-installation-deletion-root-security-"),
  );
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const filesystem = mappedFilesystem(root);
  const outside = join(root, "outside-checkouts");
  mkdirSync(outside, { mode: 0o700 });
  writeFileSync(join(outside, "must-remain"), "operator-managed");
  rmSync(join(root, "checkouts"), { recursive: true });
  symlinkSync(outside, join(root, "checkouts"));

  assert.throws(
    () =>
      deleteStoppedInstallation({
        createLock: () => ({ close() {}, exec() {} }),
        filesystem,
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "owned_path_unsafe",
  );
  assert.equal(existsSync(join(outside, "must-remain")), true);
});
