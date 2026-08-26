import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

import { ReviewRunExecutionError } from "../src/review/review-run-result.ts";
import { openReviewRunSubmissionChannel } from "../src/review/review-run-submission-channel.ts";
import { processGroupIdentity } from "../src/review/review-run-submission-process-group.ts";

const claim = Object.freeze({
  fencingToken: 7,
  workerId: "worker-1",
  workId: "run-1",
});
const boundChannels = new WeakSet();

function createCheckout(context: { after(callback: () => void): void }) {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  return checkoutPath;
}

async function closeWithForeignPrivateArtifacts(
  channel: Awaited<ReturnType<typeof openReviewRunSubmissionChannel>>,
) {
  let closeFailure: unknown = null;
  try {
    await channel.close();
  } catch (error) {
    closeFailure = error;
  }
  if (closeFailure) {
    assert.ok(closeFailure instanceof Error);
    assert.match(closeFailure.message, /ENOTEMPTY|did not drain/);
    rmSync(channel.commandDirectory, { force: true, recursive: true });
  }
}

async function submit(
  channel: Awaited<ReturnType<typeof openReviewRunSubmissionChannel>>,
  checkoutPath: string,
  candidate: unknown,
) {
  if (!boundChannels.has(channel)) {
    channel.bindProcessGroup(processGroupIdentity(process.pid) as number);
    boundChannels.add(channel);
  }
  const resultPath = join(checkoutPath, ".quality-bar-result.json");
  writeFileSync(resultPath, JSON.stringify(candidate));
  return await new Promise((resolve) => {
    execFile(
      "quality-bar-submit",
      [".quality-bar-result.json"],
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

test("returns exact recognized submission failures without accepting a Result", async (context) => {
  const failure = new ReviewRunExecutionError(
    "criterion_result_coverage_invalid",
    "Criterion Results are incomplete",
  );
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    {
      prepare() {
        throw failure;
      },
    },
    { checkoutPath },
  );
  try {
    const commandPath = join(channel.commandDirectory, "quality-bar-submit");
    assert.equal(statSync(commandPath).mode & 0o777, 0o700);
    assert.match(
      readFileSync(commandPath, "utf8"),
      /^#!\/usr\/bin\/env node\n/,
    );
    assert.equal("QUALITY_BAR_SUBMIT_PATH" in channel.environment, false);
    assert.equal(
      await submit(channel, checkoutPath, {}),
      `${failure.code}: ${failure.message}\n`,
    );
    assert.equal(channel.accepted(), false);
    assert.equal(channel.failure(), null);
    assert.equal(channel.lastValidationFailure(), failure);
  } finally {
    await closeWithForeignPrivateArtifacts(channel);
  }
});

test("keeps the file channel available for a corrected submission", async (context) => {
  let attempts = 0;
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    {
      prepare() {
        attempts += 1;
        if (attempts === 1) {
          throw new ReviewRunExecutionError(
            "criterion_result_coverage_invalid",
            "Criterion Results are incomplete",
          );
        }
      },
    },
    { checkoutPath },
  );
  try {
    assert.equal(
      await submit(channel, checkoutPath, { attempt: 1 }),
      "criterion_result_coverage_invalid: Criterion Results are incomplete\n",
    );
    assert.equal(await submit(channel, checkoutPath, { attempt: 2 }), "");
    assert.equal(await channel.waitForResult(), "accepted");
    assert.equal(attempts, 2);
  } finally {
    await channel.close();
  }
});

test("the first valid file submission stops the channel before reporting acceptance", async (context) => {
  let submissions = 0;
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    {
      prepare() {
        submissions += 1;
        return { candidate: "prepared" };
      },
    },
    { checkoutPath },
  );
  try {
    const acceptance = channel.waitForResult();
    assert.equal(await submit(channel, checkoutPath, {}), "");
    assert.equal(await acceptance, "accepted");
    assert.equal(channel.accepted(), true);
    assert.equal(submissions, 1);
    assert.equal(
      existsSync(
        join(checkoutPath, channel.environment.QUALITY_BAR_SUBMIT_FILE),
      ),
      false,
    );
    await channel.close();
    assert.equal(
      existsSync(
        join(checkoutPath, channel.environment.QUALITY_BAR_SUBMIT_FILE),
      ),
      false,
    );
  } finally {
    await channel.close();
  }
});

test("rejects a submission after the channel stops without waiting for the timeout", async (context) => {
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    { checkoutPath },
  );
  try {
    await channel.stop();
    assert.equal(
      await submit(channel, checkoutPath, {}),
      "submission_channel_unavailable: Review Run submission channel is unavailable\n",
    );
  } finally {
    await channel.close();
  }
});

test("preserves unexpected storage failures for the owning execution", async (context) => {
  const failure = new Error("sqlite write failed");
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    {
      prepare() {
        throw failure;
      },
    },
    { checkoutPath },
  );
  try {
    assert.equal(
      await submit(channel, checkoutPath, {}),
      "submission_channel_unavailable: Review Run submission channel is unavailable\n",
    );
    assert.equal(await channel.waitForResult(), "failed");
    assert.equal(channel.accepted(), false);
    assert.equal(channel.failure(), failure);
  } finally {
    await closeWithForeignPrivateArtifacts(channel);
  }
});

test("keeps the trusted command outside the checkout while exposing the endpoint to the checkout", async (context) => {
  const checkoutPath = createCheckout(context);
  let submittedCandidate: unknown;
  const channel = await openReviewRunSubmissionChannel(
    claim,
    {
      prepare(submissionClaim, candidate) {
        assert.deepEqual(submissionClaim, claim);
        submittedCandidate = candidate;
      },
    },
    { checkoutPath },
  );
  try {
    channel.bindProcessGroup(processGroupIdentity(process.pid) as number);
    assert.match(
      channel.environment.QUALITY_BAR_SUBMIT_FILE,
      /^\.qbs-[A-Za-z0-9_-]{11}\.s$/,
    );
    assert.equal(
      "QUALITY_BAR_SUBMIT_RESPONSE_FILE" in channel.environment,
      false,
    );
    assert.notEqual(channel.commandDirectory, checkoutPath);
    const resultPath = join(checkoutPath, ".quality-bar-result.json");
    writeFileSync(resultPath, '{"candidate":"from-checkout"}\n');
    await new Promise((resolve, reject) => {
      execFile(
        "quality-bar-submit",
        [".quality-bar-result.json"],
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
        (error) => (error ? reject(error) : resolve(undefined)),
      );
    });
    assert.deepEqual(submittedCandidate, { candidate: "from-checkout" });
    assert.equal(await channel.waitForResult(), "accepted");
  } finally {
    await channel.close();
  }
});

test("removes the trusted command directory when channel setup fails", async (context) => {
  const failure = new Error("submission command write failed");
  const checkoutPath = createCheckout(context);
  let commandPath = "";
  await assert.rejects(
    () =>
      openReviewRunSubmissionChannel(
        claim,
        { prepare() {} },
        {
          checkoutPath,
          writeCommand(path) {
            commandPath = String(path);
            throw failure;
          },
        },
      ),
    (error) => error === failure,
  );
  assert.notEqual(commandPath, "");
  assert.equal(existsSync(join(commandPath, "..")), false);
});

test("does not collide with a pre-existing checkout endpoint", async (context) => {
  const checkoutPath = createCheckout(context);
  const existingEndpointPath = join(checkoutPath, ".qbs.sock");
  writeFileSync(existingEndpointPath, "existing endpoint\n");
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    { checkoutPath },
  );
  assert.notEqual(channel.environment.QUALITY_BAR_SUBMIT_FILE, ".qbs.sock");
  await channel.close();
  assert.equal(
    readFileSync(existingEndpointPath, "utf8"),
    "existing endpoint\n",
  );
});

test("rejects a collision at the generated endpoint without falling back", async (context) => {
  const checkoutPath = createCheckout(context);
  const socketName = ".qbs-test.s";
  const socketPath = join(checkoutPath, socketName);
  writeFileSync(socketPath, "existing endpoint\n");
  await assert.rejects(
    () =>
      openReviewRunSubmissionChannel(
        claim,
        { prepare() {} },
        { checkoutPath, createEndpointName: () => socketName },
      ),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "submission_channel_unavailable",
  );
  assert.equal(readFileSync(socketPath, "utf8"), "existing endpoint\n");
});

test("rejects a symlink collision at the generated endpoint without following it", async (context) => {
  const checkoutPath = createCheckout(context);
  const externalDirectory = mkdtempSync(join(tmpdir(), "qbs-external-"));
  context.after(() =>
    rmSync(externalDirectory, { force: true, recursive: true }),
  );
  const socketName = ".qbs-test.s";
  const socketPath = join(checkoutPath, socketName);
  const externalSocketPath = join(externalDirectory, "socket");
  symlinkSync(externalSocketPath, socketPath);
  await assert.rejects(
    () =>
      openReviewRunSubmissionChannel(
        claim,
        { prepare() {} },
        { checkoutPath, createEndpointName: () => socketName },
      ),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "submission_channel_unavailable",
  );
  assert.equal(lstatSync(socketPath).isSymbolicLink(), true);
  assert.equal(existsSync(externalSocketPath), false);
});

test("rejects a symlinked checkout path before opening a submission channel", async (context) => {
  const checkoutPath = createCheckout(context);
  const linkRoot = mkdtempSync(join(tmpdir(), "qbs-checkout-link-"));
  context.after(() => rmSync(linkRoot, { force: true, recursive: true }));
  const linkedCheckoutPath = join(linkRoot, "checkout");
  symlinkSync(checkoutPath, linkedCheckoutPath, "dir");
  await assert.rejects(
    () =>
      openReviewRunSubmissionChannel(
        claim,
        { prepare() {} },
        { checkoutPath: linkedCheckoutPath },
      ),
    (error) =>
      error instanceof TypeError &&
      error.message === "Review Run checkout path is invalid",
  );
});

test("preserves a replaced endpoint without following its external target", async (context) => {
  const checkoutPath = createCheckout(context);
  const externalDirectory = mkdtempSync(join(tmpdir(), "qbs-external-"));
  context.after(() =>
    rmSync(externalDirectory, { force: true, recursive: true }),
  );
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    { checkoutPath },
  );
  const socketPath = join(
    checkoutPath,
    channel.environment.QUALITY_BAR_SUBMIT_FILE,
  );
  const externalSocketPath = join(externalDirectory, "socket");
  rmSync(socketPath, { force: true });
  symlinkSync(externalSocketPath, socketPath);
  await channel.close();
  assert.equal(lstatSync(socketPath).isSymbolicLink(), true);
  assert.equal(existsSync(externalSocketPath), false);
});
