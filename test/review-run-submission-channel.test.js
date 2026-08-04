import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

import { ReviewRunExecutionError } from "../src/review-run-result.js";
import { openReviewRunSubmissionChannel } from "../src/review-run-submission-channel.js";

const claim = Object.freeze({
  fencingToken: 7,
  workerId: "worker-1",
  workId: "run-1",
});

/** @param {{after(callback: () => void): void}} context */
function createCheckout(context) {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  return checkoutPath;
}

/**
 * @param {Awaited<ReturnType<typeof openReviewRunSubmissionChannel>>} channel
 * @param {string} checkoutPath
 * @param {unknown} candidate
 */
async function submit(channel, checkoutPath, candidate) {
  return await new Promise((resolve) => {
    const socket = connect(
      join(checkoutPath, channel.environment.QUALITY_BAR_SUBMIT_SOCKET),
    );
    let response = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.end(
        JSON.stringify({
          candidate,
          token: channel.environment.QUALITY_BAR_SUBMIT_TOKEN,
        }),
      );
    });
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.once("close", () => resolve(response));
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
    assert.deepEqual(JSON.parse(await submit(channel, checkoutPath, {})), {
      error: {
        code: failure.code,
        message: failure.message,
      },
      ok: false,
    });
    assert.equal(channel.accepted(), false);
    assert.equal(channel.failure(), null);
    assert.equal(channel.lastValidationFailure(), failure);
  } finally {
    await channel.close();
  }
});

test("the first valid submission closes the channel before reporting acceptance", async (context) => {
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
  const idleSocket = connect(
    join(checkoutPath, channel.environment.QUALITY_BAR_SUBMIT_SOCKET),
  );
  await new Promise((resolve) => idleSocket.once("connect", resolve));
  try {
    assert.deepEqual(JSON.parse(await submit(channel, checkoutPath, {})), {
      ok: true,
    });
    assert.equal(
      await Promise.race([
        channel.waitForResult(),
        new Promise((resolve) =>
          setImmediate(() => resolve("acceptance_stalled")),
        ),
      ]),
      "accepted",
    );
    assert.equal(channel.accepted(), true);
    assert.equal(submissions, 1);
    assert.equal(idleSocket.destroyed, true);
    assert.equal(
      existsSync(
        join(checkoutPath, channel.environment.QUALITY_BAR_SUBMIT_SOCKET),
      ),
      false,
    );
  } finally {
    idleSocket.destroy();
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
    assert.equal(await submit(channel, checkoutPath, {}), "");
    assert.equal(await channel.waitForResult(), "failed");
    assert.equal(channel.accepted(), false);
    assert.equal(channel.failure(), failure);
  } finally {
    await channel.close();
  }
});

test("keeps the trusted command outside the checkout while exposing the endpoint to the checkout", async (context) => {
  const checkoutPath = createCheckout(context);
  /** @type {unknown} */
  let submittedCandidate;
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
    assert.equal(channel.environment.QUALITY_BAR_SUBMIT_SOCKET, ".qbs.sock");
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

test("does not remove a pre-existing checkout endpoint when setup fails", async (context) => {
  const checkoutPath = createCheckout(context);
  const socketPath = join(checkoutPath, ".qbs.sock");
  writeFileSync(socketPath, "existing endpoint\n");
  const failure = new Error("submission command write failed");
  await assert.rejects(
    () =>
      openReviewRunSubmissionChannel(
        claim,
        { prepare() {} },
        {
          checkoutPath,
          writeCommand() {
            throw failure;
          },
        },
      ),
    (error) => error === failure,
  );
  assert.equal(readFileSync(socketPath, "utf8"), "existing endpoint\n");
});
