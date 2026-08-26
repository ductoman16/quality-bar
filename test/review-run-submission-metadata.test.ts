import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  publishFile,
  readSubmissionFile,
} from "../src/review/review-run-submission-files.ts";
import { removeOwnedFile } from "../src/review/review-run-submission-file-cleanup.ts";

test("publishes only a descriptor-bound restrictive regular file", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "qbs-publish-metadata-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const source = join(directory, "response.tmp");
  const target = join(directory, "response");
  writeFileSync(source, "signed-response\n", { mode: 0o600 });
  const status = lstatSync(source);
  const identity = publishFile(source, target, {
    gid: status.gid,
    mode: status.mode,
    uid: status.uid,
  });
  assert.deepEqual(identity, {
    birthtimeMs: status.birthtimeMs,
    dev: status.dev,
    ino: status.ino,
  });
  assert.equal(lstatSync(target).mode & 0o777, 0o600);
});

test("rejects bad response publication provenance without replacing a target", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "qbs-publish-reject-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const target = join(directory, "response");
  writeFileSync(target, "foreign\n", { mode: 0o600 });
  const cases: Array<{
    name: string;
    prepare: (path: string) => void;
    requirements: { uid?: number };
  }> = [
    {
      name: "permissive",
      prepare: (path) => writeFileSync(path, "bad\n", { mode: 0o640 }),
      requirements: {},
    },
    {
      name: "foreign-owner",
      prepare: (path) => writeFileSync(path, "bad\n", { mode: 0o600 }),
      requirements: { uid: (process.getuid?.() ?? 0) + 1 },
    },
    {
      name: "symlink",
      prepare: (path) => symlinkSync(target, path),
      requirements: {},
    },
  ];
  for (const { name, prepare, requirements } of cases) {
    const source = join(directory, `response.tmp-${name}`);
    prepare(source);
    const status = lstatSync(source);
    assert.throws(
      () =>
        publishFile(source, target, {
          gid: status.gid,
          mode: 0o100600,
          uid: status.uid,
          ...requirements,
        }),
      /publication|EEXIST|symbolic link/i,
    );
    assert.equal(lstatSync(target).isFile(), true);
  }
});

test("does not adopt a same-uid inode replacement at publication", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "qbs-publish-race-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const source = join(directory, "response.tmp");
  const replacement = join(directory, "replacement");
  const target = join(directory, "response");
  writeFileSync(source, "signed\n", { mode: 0o600 });
  writeFileSync(replacement, "replacement\n", { mode: 0o600 });
  const sourceStatus = lstatSync(source);
  assert.throws(
    () =>
      publishFile(
        source,
        target,
        {
          gid: sourceStatus.gid,
          mode: sourceStatus.mode,
          uid: sourceStatus.uid,
        },
        {
          beforeOpen: () => {
            rmSync(source);
            linkSync(replacement, source);
          },
        },
      ),
    /source is not a file/,
  );
  assert.equal(lstatSync(replacement).isFile(), true);
  assert.throws(() => lstatSync(source), /ENOENT/);

  const secondSource = join(directory, "response.tmp-second");
  writeFileSync(secondSource, "signed\n", { mode: 0o600 });
  const secondStatus = lstatSync(secondSource);
  assert.throws(
    () =>
      publishFile(
        secondSource,
        target,
        {
          gid: secondStatus.gid,
          mode: secondStatus.mode,
          uid: secondStatus.uid,
        },
        {
          afterLink: () => {
            rmSync(target);
            linkSync(replacement, target);
          },
        },
      ),
    /publication identity changed/,
  );
  assert.equal(lstatSync(target).ino, lstatSync(replacement).ino);
});

test("rejects submission artifacts with foreign ownership or permissive mode", (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-artifact-owner-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const path = join(checkoutPath, "ack");
  writeFileSync(path, "{}\n", { mode: 0o600 });
  const status = lstatSync(path);
  const unavailable = () => new Error("unavailable");
  assert.equal(readSubmissionFile(path, unavailable, status).content, "{}\n");
  assert.throws(
    () =>
      readSubmissionFile(path, unavailable, {
        uid: status.uid + 1,
        gid: status.gid,
      }),
    /unavailable/,
  );
  chmodSync(path, 0o640);
  assert.throws(
    () => readSubmissionFile(path, unavailable, status),
    /unavailable/,
  );
  const targetPath = join(checkoutPath, "foreign-ack");
  writeFileSync(targetPath, "{}\n", { mode: 0o600 });
  rmSync(path, { force: true });
  symlinkSync(targetPath, path);
  assert.throws(
    () => readSubmissionFile(path, unavailable, lstatSync(targetPath)),
    /unavailable/,
  );
});

test("preserves an ACK whose metadata changes before identity-safe removal", (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-ack-metadata-race-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const path = join(checkoutPath, "ack");
  writeFileSync(path, "{}\n", { mode: 0o600 });
  const status = lstatSync(path);
  assert.throws(
    () =>
      removeOwnedFile(
        path,
        {
          dev: status.dev,
          gid: status.gid,
          ino: status.ino,
          mode: status.mode,
          uid: status.uid,
        },
        { beforeRename: () => chmodSync(path, 0o640) },
      ),
    /metadata changed/,
  );
  assert.equal(lstatSync(path).mode & 0o777, 0o640);
});
