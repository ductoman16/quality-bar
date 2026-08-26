import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  BACKUPS_PATH,
  CHECKOUTS_PATH,
  CODEX_HOME_PATH,
  STATE_PATH,
} from "../src/installation-environment.ts";
import {
  INSTALLATION_DELETION_PATHS,
  deleteStoppedInstallation,
} from "../src/installation-deletion.ts";

const directories = [STATE_PATH, CODEX_HOME_PATH, CHECKOUTS_PATH, BACKUPS_PATH];

function createFilesystem(
  input: {
    invalidEntry?: boolean;
    missingPath?: string;
    removeFailure?: string;
  } = {},
) {
  const entries = new Map([
    [
      STATE_PATH,
      new Set(["installation.lock", "quality-bar.sqlite3", "codex-home"]),
    ],
    [CODEX_HOME_PATH, new Set(["auth.json"])],
    [CHECKOUTS_PATH, new Set(["review-run"])],
    [BACKUPS_PATH, new Set(["backup.sqlite3", "backup.json"])],
  ]);
  const removed: string[] = [];
  let released = false;
  return {
    filesystem: {
      lstat(path: string) {
        if (path === input.missingPath) {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
        return {
          gid: 10001,
          isDirectory: () => directories.includes(path),
          isSymbolicLink: () => false,
          mode: 0o40700,
          uid: 10001,
        };
      },
      readdir(path: string) {
        if (input.invalidEntry && path === STATE_PATH) {
          return [{ name: "../outside" }];
        }
        return [...(entries.get(path) ?? [])].map((name) => ({ name }));
      },
      remove(path: string) {
        if (path === input.removeFailure) {
          throw new Error("remove failed");
        }
        removed.push(path);
        for (const [parent, names] of entries) {
          const prefix = `${parent}/`;
          if (path.startsWith(prefix)) {
            names.delete(path.slice(prefix.length));
          }
        }
      },
    },
    createLock() {
      return {
        close() {
          released = true;
        },
        exec() {},
      };
    },
    removed,
    get released() {
      return released;
    },
  };
}

test("deletes only the exact owned roots and verifies every root before success", () => {
  const input = createFilesystem();

  const result = deleteStoppedInstallation({
    createLock: input.createLock,
    filesystem: input.filesystem,
  });

  assert.deepEqual(result, {
    paths: INSTALLATION_DELETION_PATHS,
    status: "installation_deleted",
  });
  assert.deepEqual(input.removed, [
    join(CODEX_HOME_PATH, "auth.json"),
    join(STATE_PATH, "quality-bar.sqlite3"),
    join(CHECKOUTS_PATH, "review-run"),
    join(BACKUPS_PATH, "backup.sqlite3"),
    join(BACKUPS_PATH, "backup.json"),
  ]);
  assert.equal(input.released, true);
  assert.equal(
    input.removed.includes(join(STATE_PATH, "installation.lock")),
    false,
  );
  assert.equal(
    input.removed.some((path) => path.includes("config.env")),
    false,
  );
  assert.equal(
    input.removed.some((path) => path.includes("master-key")),
    false,
  );
});

test("preflights every root so a later read failure performs no deletion", () => {
  const input = createFilesystem({ missingPath: BACKUPS_PATH });
  assert.throws(
    () =>
      deleteStoppedInstallation({
        createLock: input.createLock,
        filesystem: input.filesystem,
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "owned_path_missing",
  );
  assert.deepEqual(input.removed, []);
  assert.equal(input.released, true);
});

test("rejects traversal-shaped entries before touching any owned path", () => {
  const input = createFilesystem({ invalidEntry: true });
  assert.throws(
    () =>
      deleteStoppedInstallation({
        createLock: input.createLock,
        filesystem: input.filesystem,
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "installation_deletion_path_unsafe",
  );
  assert.deepEqual(input.removed, []);
});

test("surfaces the exact removal failure and never reports inferred success", () => {
  const input = createFilesystem({
    removeFailure: join(CHECKOUTS_PATH, "review-run"),
  });

  assert.throws(
    () =>
      deleteStoppedInstallation({
        createLock: input.createLock,
        filesystem: input.filesystem,
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "installation_deletion_remove_failed" &&
      "path" in error &&
      error.path === join(CHECKOUTS_PATH, "review-run"),
  );
  assert.equal(
    input.removed.includes(join(BACKUPS_PATH, "backup.sqlite3")),
    false,
  );
});

test("preserves non-Error failures instead of inferring success", () => {
  for (const failure of [undefined, "non-error deletion failure"]) {
    const input = createFilesystem();
    assert.throws(
      () =>
        deleteStoppedInstallation({
          filesystem: input.filesystem,
          validateInstallation() {
            throw failure;
          },
        }),
      (error) => error === failure,
    );
    assert.deepEqual(input.removed, []);
  }
});

test("deletion is an explicit stopped-installation command, not maintenance", () => {
  const command = readFileSync(
    new URL("../src/delete-installation.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(command, /process\.argv|cleanup|retention/);
});
