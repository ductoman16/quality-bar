import assert from "node:assert/strict";
import { connect } from "node:net";
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
    assert.deepEqual(JSON.parse(await submit(channel, {})), {
      error: {
        code: failure.code,
        message: failure.message,
      },
      ok: false,
    });
    assert.equal(channel.accepted(), false);
    assert.equal(channel.failure(), null);
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
    assert.equal(channel.accepted(), false);
    assert.equal(channel.failure(), failure);
  } finally {
    await channel.close();
  }
});
