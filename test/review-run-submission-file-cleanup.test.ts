import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  removeOwnedDirectory,
  removeOwnedFile,
} from "../src/review/review-run-submission-file-cleanup.ts";

test("restores a symlink replacement before reporting non-file cleanup", (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-ownership-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const path = join(checkoutPath, "artifact");
  writeFileSync(path, "owned\n");
  const owned = lstatSync(path);
  rmSync(path, { force: true });
  symlinkSync("foreign-target", path);
  removeOwnedFile(path, {
    birthtimeMs: owned.birthtimeMs,
    dev: owned.dev,
    ino: owned.ino,
  });
  assert.equal(lstatSync(path).isSymbolicLink(), true);
  assert.equal(readlinkSync(path), "foreign-target");
});

test("preserves both artifacts when restoration races a replacement", (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-ownership-race-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const path = join(checkoutPath, "artifact");
  writeFileSync(path, "owned\n");
  const owned = lstatSync(path);
  let preservedPath: string | null = null;
  assert.throws(
    () =>
      removeOwnedFile(
        path,
        { birthtimeMs: owned.birthtimeMs, dev: owned.dev, ino: owned.ino },
        {
          beforeRename: () => {
            rmSync(path, { force: true });
            symlinkSync("foreign-target", path);
          },
          afterQuarantine: () => writeFileSync(path, "replacement\n"),
        },
      ),
    (error) => {
      const message = error instanceof Error ? error.message : "";
      assert.match(message, /preserved the quarantined artifact at /);
      preservedPath = message.replace(
        /^.*preserved the quarantined artifact at /,
        "",
      );
      return true;
    },
  );
  assert.ok(preservedPath);
  assert.equal(readlinkSync(preservedPath), "foreign-target");
  assert.equal(lstatSync(path).isFile(), true);
  rmSync(preservedPath, { force: true });
});

test("never deletes a foreign file installed at the quarantine pathname", (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-quarantine-aba-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const path = join(checkoutPath, "artifact");
  writeFileSync(path, "owned\n");
  const owned = lstatSync(path);
  let displacedPath = "";

  const removed = removeOwnedFile(
    path,
    { birthtimeMs: owned.birthtimeMs, dev: owned.dev, ino: owned.ino },
    {
      afterQuarantine(quarantinePath) {
        displacedPath = `${quarantinePath}.displaced`;
        renameSync(quarantinePath, displacedPath);
        writeFileSync(quarantinePath, "foreign\n", { flag: "wx" });
      },
    },
  );

  assert.equal(removed, false);
  assert.equal(readFileSync(displacedPath, "utf8"), "owned\n");
  assert.equal(
    readFileSync(displacedPath.replace(/\.displaced$/u, ""), "utf8"),
    "foreign\n",
  );
});

test("never deletes a foreign directory installed at the quarantine pathname", (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-directory-aba-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const path = join(checkoutPath, "artifact");
  mkdirSync(path);
  writeFileSync(join(path, "owned.txt"), "owned\n");
  const owned = lstatSync(path);
  let quarantinePath = "";
  let displacedPath = "";

  const removed = removeOwnedDirectory(
    path,
    {
      birthtimeMs: owned.birthtimeMs,
      dev: owned.dev,
      gid: owned.gid,
      ino: owned.ino,
      uid: owned.uid,
    },
    {
      afterQuarantine(candidate) {
        quarantinePath = candidate;
        displacedPath = `${candidate}.displaced`;
        renameSync(candidate, displacedPath);
        mkdirSync(candidate);
        writeFileSync(join(candidate, "foreign.txt"), "foreign\n");
      },
    },
  );

  assert.equal(removed, false);
  assert.equal(
    readFileSync(join(displacedPath, "owned.txt"), "utf8"),
    "owned\n",
  );
  assert.equal(
    readFileSync(join(quarantinePath, "foreign.txt"), "utf8"),
    "foreign\n",
  );
});

test("owned file cleanup removes the validated inode and its quarantine", (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-file-cleanup-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const path = join(checkoutPath, "artifact");
  writeFileSync(path, "owned\n");
  const owned = lstatSync(path);

  assert.equal(
    removeOwnedFile(path, {
      birthtimeMs: owned.birthtimeMs,
      dev: owned.dev,
      ino: owned.ino,
    }),
    true,
  );
  assert.equal(existsSync(path), false);
  assert.deepEqual(readdirSync(checkoutPath), []);
});

test("owned directory cleanup removes the validated inode and its quarantine", (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-directory-cleanup-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const path = join(checkoutPath, "artifact");
  mkdirSync(path);
  writeFileSync(join(path, "owned.txt"), "owned\n");
  const owned = lstatSync(path);

  assert.equal(
    removeOwnedDirectory(path, {
      birthtimeMs: owned.birthtimeMs,
      dev: owned.dev,
      gid: owned.gid,
      ino: owned.ino,
      uid: owned.uid,
    }),
    true,
  );
  assert.equal(existsSync(path), false);
  assert.deepEqual(readdirSync(checkoutPath), []);
});
