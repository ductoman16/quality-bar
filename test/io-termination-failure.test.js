import assert from "node:assert/strict";
import { test } from "node:test";

import { createIoExecutionPool } from "../src/io-execution-pool.js";
import { throwIoTerminationFailure } from "../src/io-operation-context.js";

test("the pool preserves a wrapped checkout termination failure", async () => {
  const pool = createIoExecutionPool();
  const operation = Promise.withResolvers();
  const completion = pool.run("acquisition", () => operation.promise);
  const storageFailure = Object.assign(
    new Error("SQLite durable write failed"),
    { code: "storage_unavailable" },
  );
  const terminationFailure = Object.assign(
    new Error("Review Run checkout could not terminate"),
    { code: "review_run_checkout_termination_failed" },
  );
  await new Promise((resolve) => setImmediate(resolve));

  pool.shutdown(storageFailure);
  operation.reject(terminationFailure);

  await assert.rejects(completion, (error) => error === terminationFailure);
  await pool.close();
});

test("nested termination and cleanup failures retain the termination owner", () => {
  const terminationFailure = Object.assign(
    new Error("Review Run checkout could not terminate"),
    { code: "review_run_checkout_termination_failed" },
  );
  const cleanupFailure = new Error("checkout cleanup failed");
  const wrapped = new Error("Evaluation acquisition failed", {
    cause: terminationFailure,
  });

  assert.throws(
    () =>
      throwIoTerminationFailure(wrapped, () => {
        throw cleanupFailure;
      }),
    (error) =>
      error instanceof AggregateError &&
      "code" in error &&
      error.code === "review_run_checkout_termination_failed" &&
      error.errors[0] === terminationFailure &&
      error.errors[1] === cleanupFailure,
  );
});
