import assert from "node:assert/strict";
import test from "node:test";

import {
  IO_EXECUTION_CONCURRENCY,
  createIoExecutionPool,
} from "../src/io-execution-pool.js";

test("the fixed I/O pool bounds independent duties without hiding failures", async () => {
  assert.equal(IO_EXECUTION_CONCURRENCY, 4);
  let active = 0;
  let maximumActive = 0;
  /** @type {((value?: void) => void)[]} */
  const releases = [];
  const pool = createIoExecutionPool();
  const duties = /** @type {const} */ ([
    "polling",
    "acquisition",
    "delivery",
    "retention",
    "cleanup",
    "polling",
  ]);
  const tasks = duties.map(createTask);

  /** @param {(typeof duties)[number]} duty */
  function createTask(duty) {
    return pool.run(duty, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return duty;
    });
  }

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 4);
  releases.splice(0, 4).forEach((release) => release());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 2);
  releases.splice(0).forEach((release) => release());
  assert.deepEqual(await Promise.all(tasks), [
    "polling",
    "acquisition",
    "delivery",
    "retention",
    "cleanup",
    "polling",
  ]);
  assert.equal(maximumActive, 4);

  const owningFailure = Object.assign(new Error("delivery failed exactly"), {
    code: "github_delivery_failed",
  });
  await assert.rejects(
    pool.run("delivery", () => {
      throw owningFailure;
    }),
    (error) => error === owningFailure,
  );
  assert.throws(
    () => pool.run(/** @type {any} */ ("other"), () => {}),
    /I\/O execution duty is invalid/,
  );
});
