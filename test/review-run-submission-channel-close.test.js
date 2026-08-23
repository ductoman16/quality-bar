import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  rmdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { openReviewRunSubmissionChannel } from "../src/review/review-run-submission-channel.js";
import { createSubmissionChannelSurface } from "../src/review/review-run-submission-channel-surface.js";
import { publishFile } from "../src/review/review-run-submission-files.js";

const claim = Object.freeze({
  fencingToken: 7,
  workerId: "worker-1",
  workId: "run-1",
});

test("close reclaims installed submission files including the token", async (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-close-reclaim-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    { checkoutPath },
  );
  const commandDirectory = channel.commandDirectory;
  const commandDirectoryName = basename(commandDirectory);
  const temporaryParent = dirname(commandDirectory);

  await channel.close();

  assert.equal(existsSync(commandDirectory), false);
  assert.deepEqual(
    readdirSync(temporaryParent).filter((name) =>
      name.includes(commandDirectoryName),
    ),
    [],
  );
});

test("close surfaces a close-marker publication failure", async (context) => {
  const failure = new Error("close marker publication failed");
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-close-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    {
      checkoutPath,
      publishFile(sourcePath, destinationPath) {
        if (destinationPath.endsWith(".closed")) {
          throw failure;
        }
        return publishFile(sourcePath, destinationPath);
      },
    },
  );
  await assert.rejects(
    () => channel.close(),
    (error) => error === failure,
  );
});

test("the submission surface waits for the live rejected-submission ACK settlement", async () => {
  /** @type {(result: "failed") => void} */
  let settle = () => {};
  const pendingSettlement = new Promise((resolve) => {
    settle = resolve;
  });
  const channel = createSubmissionChannelSurface({
    pendingSettlement: () => pendingSettlement,
  });
  const waiting = channel.waitForPendingSubmission();
  let finished = false;
  Promise.resolve(waiting).then(() => {
    finished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  settle("failed");
  assert.equal(await waiting, "failed");
});

test("the submission surface never swallows a falsy cleanup rejection", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "qbs-close-falsy-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const status = lstatSync(directory);
  const channel = createSubmissionChannelSurface({
    commandPath: join(directory, "command"),
    directory,
    directoryIdentity: {
      birthtimeMs: status.birthtimeMs,
      dev: status.dev,
      gid: status.gid,
      ino: status.ino,
      uid: status.uid,
    },
    identities: {
      acknowledgmentIdentity: null,
      closedIdentity: null,
      lockIdentity: null,
      requestIdentity: null,
      responseIdentity: null,
    },
    installation: {
      commandIdentity: { dev: 1, ino: 2 },
      runtimeIdentity: null,
      tokenIdentity: null,
      tokenPath: join(directory, "token"),
      trustedProcessIdentity: null,
      trustedProcessPath: join(directory, "process"),
    },
    paths: {
      acknowledgmentPath: join(directory, "ack"),
      closedPath: join(directory, "closed"),
      lockPath: join(directory, "lock"),
      requestPath: join(directory, "request"),
      responsePath: join(directory, "response"),
    },
    removeDirectory(/** @type {string} */ path) {
      rmdirSync(path);
    },
    removeOwnedFile() {
      runInNewContext("throw undefined");
    },
    runtimePath: join(directory, "runtime"),
    state: { pendingResponse: null },
    stopAccepting() {},
    stopFailure: () => null,
  });

  await assert.rejects(() => channel.close(), /submission cleanup failed/u);
});
