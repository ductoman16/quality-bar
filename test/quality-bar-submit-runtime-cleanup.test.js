import assert from "node:assert/strict";
import fs from "node:fs";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  outerProcessId,
  removeOwnedFile,
} from "../src/quality-bar-submit-runtime.js";

test("uses the outer PID when the submitter runs in a PID namespace", () => {
  assert.equal(outerProcessId("Name:\tnode\nNSpid:\t4321\t7\n", 7), 4321);
  assert.equal(outerProcessId("Name:\tnode\n", 7), 7);
});

test("installed submission cleanup reclaims its validated inode", (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-runtime-reclaimed-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const path = join(checkoutPath, "artifact");
  writeFileSync(path, "owned\n");
  const owned = lstatSync(path);
  removeOwnedFile(path, {
    birthtimeMs: owned.birthtimeMs,
    dev: owned.dev,
    ino: owned.ino,
  });
  assert.equal(existsSync(path), false);
  assert.deepEqual(readdirSync(checkoutPath), []);
});

test("installed submission cleanup preserves a canonical replacement", (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-runtime-race-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const path = join(checkoutPath, "artifact");
  writeFileSync(path, "owned\n");
  const owned = lstatSync(path);
  const originalRename = fs.renameSync;
  try {
    fs.renameSync = (source, target) => {
      if (source === path) {
        rmSync(path);
        writeFileSync(path, "foreign\n", { flag: "wx" });
      }
      return originalRename(source, target);
    };
    syncBuiltinESMExports();
    removeOwnedFile(path, {
      birthtimeMs: owned.birthtimeMs,
      dev: owned.dev,
      ino: owned.ino,
    });
  } finally {
    fs.renameSync = originalRename;
    syncBuiltinESMExports();
  }
  assert.equal(readFileSync(path, "utf8"), "foreign\n");
});
