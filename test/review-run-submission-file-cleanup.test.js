import assert from "node:assert/strict";
import {
  lstatSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { removeOwnedFile } from "../src/review-run-submission-file-cleanup.js";

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
  /** @type {string | null} */
  let preservedPath = null;
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
