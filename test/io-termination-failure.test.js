import assert from "node:assert/strict";
import { test } from "node:test";

import { createIoExecutionPool } from "../src/io-execution-pool.js";

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
