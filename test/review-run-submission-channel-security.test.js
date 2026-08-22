import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

import { openReviewRunSubmissionChannel } from "../src/review/review-run-submission-channel.js";
import { publishSignedResponse } from "../src/review/review-run-submission-response.js";
import {
  isProcessAlive,
  parseSubmissionLock,
  publishFile,
} from "../src/review/review-run-submission-files.js";
import { removeOwnedFile } from "../src/review/review-run-submission-file-cleanup.js";
import { processGroupIdentity } from "../src/review/review-run-submission-process-group.js";

const claim = Object.freeze({
  fencingToken: 7,
  workerId: "worker-1",
  workId: "run-1",
});
const boundChannels = new WeakSet();

/** @param {{after(callback: () => void): void}} context */
function createCheckout(context) {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-security-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  return checkoutPath;
}

/** @param {Awaited<ReturnType<typeof openReviewRunSubmissionChannel>>} channel */
function runtimePath(channel) {
  return join(channel.commandDirectory, "quality-bar-submit-runtime.js");
}

/** @param {Awaited<ReturnType<typeof openReviewRunSubmissionChannel>>} channel */
function getResponsePath(channel) {
  const source = readFileSync(runtimePath(channel), "utf8");
  return JSON.parse(source.match(/responseFileName = (.+);/)?.[1] ?? "null");
}

/** @param {Awaited<ReturnType<typeof openReviewRunSubmissionChannel>>} channel */
async function closeWithForeignPrivateArtifacts(channel) {
  /** @type {unknown} */
  let closeFailure = null;
  try {
    await channel.close();
  } catch (error) {
    closeFailure = error;
  }
  assert.ok(closeFailure instanceof Error);
  assert.match(closeFailure.message, /ENOTEMPTY|did not drain/);
  rmSync(channel.commandDirectory, { force: true, recursive: true });
}

/**
 * @param {Awaited<ReturnType<typeof openReviewRunSubmissionChannel>>} channel
 * @param {string} checkoutPath
 * @param {string[]} [arguments_]
 */
async function submit(
  channel,
  checkoutPath,
  arguments_ = [".quality-bar-result.json"],
) {
  if (!boundChannels.has(channel)) {
    channel.bindProcessGroup(
      /** @type {number} */ (processGroupIdentity(process.pid)),
    );
    boundChannels.add(channel);
  }
  const resultPath = join(checkoutPath, ".quality-bar-result.json");
  writeFileSync(resultPath, "{}");
  return await new Promise((resolve) => {
    execFile(
      "quality-bar-submit",
      arguments_,
      {
        cwd: checkoutPath,
        env: {
          ...channel.environment,
          PATH: [
            channel.commandDirectory,
            dirname(process.execPath),
            "/usr/bin",
            "/bin",
          ].join(delimiter),
        },
      },
      (...callbackArguments) => {
        const [error, , stderr] = callbackArguments;
        resolve(error ? stderr : "");
      },
    );
  });
}

test("does not accept a forged response from the writable checkout", async (context) => {
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    { checkoutPath },
  );
  const commandSource = readFileSync(
    join(channel.commandDirectory, "quality-bar-submit"),
    "utf8",
  );
  const responsePath = getResponsePath(channel);
  const runtimeStatus = lstatSync(runtimePath(channel));
  assert.equal(runtimeStatus.mode & 0o777, 0o600);
  assert.equal(runtimeStatus.isSymbolicLink(), false);
  assert.equal(commandSource.includes(`${checkoutPath}/`), false);
  assert.equal(commandSource.includes("response_token"), false);
  assert.match(commandSource, /request_signature:\s*helpers\.requestSignature/);
  assert.doesNotMatch(commandSource, /request_id:\s*requestId,\s*token,/s);
  assert.equal(
    commandSource.includes(channel.environment.QUALITY_BAR_SUBMIT_TOKEN),
    false,
  );
  assert.equal(commandSource.includes("BEGIN PRIVATE KEY"), false);
  assert.equal(commandSource.includes("rmSync(responsePath"), false);
  assert.match(
    commandSource,
    /helpers\.removeOwnedFile\(responsePath, response\.identity\)/,
  );
  writeFileSync(
    responsePath,
    JSON.stringify({
      payload: { ok: true, request_id: "forged" },
      response_signature: "forged",
    }),
  );
  try {
    assert.equal(
      await submit(channel, checkoutPath),
      "submission_channel_unavailable: Review Run submission response is invalid\n",
    );
  } finally {
    await closeWithForeignPrivateArtifacts(channel);
  }
});

test("rejects a concurrent submission without overwriting the active lock", async (context) => {
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    { checkoutPath },
  );
  const lockPath = join(
    checkoutPath,
    `${channel.environment.QUALITY_BAR_SUBMIT_FILE}.lock`,
  );
  const responsePath = getResponsePath(channel);
  const responseContents = JSON.stringify({ sentinel: true });
  writeFileSync(responsePath, responseContents);
  writeFileSync(lockPath, "active\n");
  try {
    assert.equal(
      await submit(channel, checkoutPath),
      "submission_channel_unavailable: Review Run submission channel is unavailable\n",
    );
    assert.equal(readFileSync(lockPath, "utf8"), "active\n");
    assert.equal(readFileSync(responsePath, "utf8"), responseContents);
  } finally {
    await closeWithForeignPrivateArtifacts(channel);
  }
});

test("does not adopt unobserved submission artifacts during shutdown", async (context) => {
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    { checkoutPath, removeDirectory: () => {} },
  );
  context.after(() =>
    rmSync(channel.commandDirectory, { force: true, recursive: true }),
  );
  const requestPath = join(
    checkoutPath,
    channel.environment.QUALITY_BAR_SUBMIT_FILE,
  );
  const lockPath = `${requestPath}.lock`;
  const responsePath = getResponsePath(channel);
  const paths = [requestPath, lockPath, responsePath, `${responsePath}.ack`];
  for (const [index, path] of paths.entries()) {
    writeFileSync(path, `foreign-${index}\n`);
  }
  await channel.stop();
  await assert.rejects(
    () => channel.close(),
    /submission command directory was not removed/,
  );
  for (const path of paths) {
    assert.equal(existsSync(path), true);
  }
});

test("rejects OS-invalid lease PIDs without crashing the polling worker", () => {
  const invalidPid = Number.MAX_SAFE_INTEGER;
  assert.equal(
    parseSubmissionLock({
      content: JSON.stringify({
        client_id: "invalid-pid",
        client_pid: invalidPid,
        client_process_group_id: 1,
        client_start_identity: "linux:invalid-pid",
        request_id: "invalid-pid-request",
      }),
      mtimeMs: Date.now(),
    }),
    null,
  );
  assert.equal(isProcessAlive(invalidPid), false);
});

test("does not adopt a late replacement during close", async (context) => {
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    { checkoutPath },
  );
  const requestPath = join(
    checkoutPath,
    channel.environment.QUALITY_BAR_SUBMIT_FILE,
  );
  writeFileSync(requestPath, "owned-before-stop\n");
  await channel.stop();
  rmSync(requestPath, { force: true });
  writeFileSync(requestPath, "foreign-after-stop\n");
  await channel.close();
  assert.equal(readFileSync(requestPath, "utf8"), "foreign-after-stop\n");
  rmSync(requestPath, { force: true });
});

test("does not adopt a replacement created while the close marker becomes visible", async (context) => {
  const checkoutPath = createCheckout(context);
  const endpointName = ".qbs-visibility.s";
  const requestPath = join(checkoutPath, endpointName);
  const closedPath = `${requestPath}.closed`;
  let replacementPublished = false;
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    {
      checkoutPath,
      createEndpointName: () => endpointName,
      publishFile(temporaryPath, targetPath) {
        const identity = publishFile(temporaryPath, targetPath);
        if (targetPath === closedPath) {
          rmSync(requestPath, { force: true });
          writeFileSync(requestPath, "foreign-during-visibility\n");
          replacementPublished = true;
        }
        return identity;
      },
    },
  );
  writeFileSync(requestPath, "owned-before-visibility\n");
  await channel.stop();
  assert.equal(replacementPublished, true);
  await channel.close();
  assert.equal(
    readFileSync(requestPath, "utf8"),
    "foreign-during-visibility\n",
  );
  rmSync(requestPath, { force: true });
});

test("preserves an observed lock when replaced before shutdown", async (context) => {
  const checkoutPath = createCheckout(context);
  let lockPath = "";
  const channel = await openReviewRunSubmissionChannel(
    claim,
    {
      prepare() {
        rmSync(lockPath, { force: true });
        writeFileSync(lockPath, "foreign-lock\n");
      },
    },
    { checkoutPath },
  );
  lockPath = join(
    checkoutPath,
    `${channel.environment.QUALITY_BAR_SUBMIT_FILE}.lock`,
  );
  try {
    assert.equal(await submit(channel, checkoutPath), "");
    assert.equal(await channel.waitForResult(), "accepted");
    await assert.rejects(
      () => channel.close(),
      /Review Run submission channel did not drain/,
    );
    assert.equal(readFileSync(lockPath, "utf8"), "foreign-lock\n");
    rmSync(lockPath, { force: true });
    await channel.close();
  } catch (error) {
    rmSync(lockPath, { force: true });
    throw error;
  }
});

test("preserves a replaced close marker through shutdown cleanup", (context) => {
  const checkoutPath = createCheckout(context);
  const temporaryPath = join(checkoutPath, ".qbs-close.tmp");
  const closedPath = join(checkoutPath, ".qbs-close.closed");
  writeFileSync(temporaryPath, "closed\n");
  const closedIdentity = publishFile(temporaryPath, closedPath);
  rmSync(closedPath, { force: true });
  writeFileSync(closedPath, "foreign-close-marker\n");
  removeOwnedFile(closedPath, closedIdentity);
  assert.equal(readFileSync(closedPath, "utf8"), "foreign-close-marker\n");
});

test("retains response ownership when a fast client removes it before publication returns", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "qbs-response-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const responsePath = join(directory, "response");
  const { privateKey } = generateKeyPairSync("ed25519");
  const responseIdentity = publishSignedResponse(
    directory,
    responsePath,
    privateKey,
    { ok: true },
    "response-request",
    () => "response",
    (temporaryPath, targetPath) => {
      const identity = publishFile(temporaryPath, targetPath);
      rmSync(targetPath, { force: true });
      return identity;
    },
  );
  writeFileSync(responsePath, "foreign-response\n");
  removeOwnedFile(responsePath, responseIdentity);
  assert.equal(readFileSync(responsePath, "utf8"), "foreign-response\n");
});

test("preserves a replacement that reuses an owned inode", (context) => {
  const checkoutPath = createCheckout(context);
  const path = join(checkoutPath, "artifact");
  writeFileSync(path, "owned\n");
  const owned = lstatSync(path);
  rmSync(path, { force: true });
  writeFileSync(path, "replacement\n");
  const replacement = lstatSync(path);
  removeOwnedFile(path, {
    birthtimeMs: owned.birthtimeMs,
    dev: replacement.dev,
    ino: replacement.ino,
  });
  assert.equal(readFileSync(path, "utf8"), "replacement\n");
});

test("requires the literal review Result file argument", async (context) => {
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    { checkoutPath },
  );
  try {
    const expected =
      "submission_channel_unavailable: Review Run submission channel is unavailable\n";
    assert.equal(await submit(channel, checkoutPath, []), expected);
    assert.equal(
      await submit(channel, checkoutPath, ["arbitrary-result.json"]),
      expected,
    );
  } finally {
    await channel.close();
  }
});
