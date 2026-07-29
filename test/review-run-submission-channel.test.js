import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { test } from "node:test";

import { ReviewRunExecutionError } from "../src/review-run-result.js";
import { openReviewRunSubmissionChannel } from "../src/review-run-submission-channel.js";

const claim = Object.freeze({
  fencingToken: 7,
  workerId: "worker-1",
  workId: "run-1",
});

/**
 * @param {Awaited<ReturnType<typeof openReviewRunSubmissionChannel>>} channel
 * @param {unknown} candidate
 */
async function submit(channel, candidate) {
  return await new Promise((resolve) => {
    const socket = connect(channel.environment.QUALITY_BAR_SUBMIT_SOCKET);
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

test("returns exact recognized submission failures without accepting a Result", async () => {
  const failure = new ReviewRunExecutionError(
    "criterion_result_coverage_invalid",
    "Criterion Results are incomplete",
  );
  const channel = await openReviewRunSubmissionChannel(claim, {
    submit() {
      throw failure;
    },
  });
  try {
    const commandPath = join(channel.commandDirectory, "quality-bar-submit");
    assert.equal(statSync(commandPath).mode & 0o777, 0o700);
    assert.match(
      readFileSync(commandPath, "utf8"),
      /^#!\/usr\/bin\/env node\n/,
    );
    assert.equal("QUALITY_BAR_SUBMIT_PATH" in channel.environment, false);
    assert.deepEqual(JSON.parse(await submit(channel, {})), {
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

test("the first valid submission closes the channel before reporting acceptance", async () => {
  let submissions = 0;
  const channel = await openReviewRunSubmissionChannel(claim, {
    submit() {
      submissions += 1;
    },
  });
  try {
    assert.deepEqual(JSON.parse(await submit(channel, {})), { ok: true });
    assert.equal(await channel.waitForResult(), "accepted");
    assert.equal(channel.accepted(), true);
    assert.equal(submissions, 1);
    assert.equal(
      existsSync(channel.environment.QUALITY_BAR_SUBMIT_SOCKET),
      false,
    );
  } finally {
    await channel.close();
  }
});

test("preserves unexpected storage failures for the owning execution", async () => {
  const failure = new Error("sqlite write failed");
  const channel = await openReviewRunSubmissionChannel(claim, {
    submit() {
      throw failure;
    },
  });
  try {
    assert.equal(await submit(channel, {}), "");
    assert.equal(await channel.waitForResult(), "failed");
    assert.equal(channel.accepted(), false);
    assert.equal(channel.failure(), failure);
  } finally {
    await channel.close();
  }
});

test("removes the trusted command directory when channel setup fails", async () => {
  const failure = new Error("submission command write failed");
  let commandPath = "";
  await assert.rejects(
    () =>
      openReviewRunSubmissionChannel(
        claim,
        { submit() {} },
        {
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
