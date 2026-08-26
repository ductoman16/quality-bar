import assert from "node:assert/strict";
import test from "node:test";

import { createCodexExecutionConcurrencyService } from "../src/codex/codex-execution-concurrency.ts";

test("Codex concurrency accepts only exact integers from one through four", () => {
  let stored = 1;
  const service = createCodexExecutionConcurrencyService({
    get() {
      return { maximum_running: stored };
    },
    transaction(callback: (transaction: any) => unknown) {
      return callback({
        run(sql: string, value: unknown) {
          assert.match(sql, /UPDATE codex_execution_settings/);
          stored = value as number;
          return { changes: 1 };
        },
      });
    },
  });

  assert.equal(service.read(), 1);
  for (const value of [2, 3, 4, 1]) {
    assert.equal(service.set(value), value);
    assert.equal(service.read(), value);
  }
  for (const value of [0, 1.5, 5, "2", null, undefined]) {
    assert.throws(
      () => service.set(value),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "codex_execution_concurrency_invalid" &&
        error.message ===
          "Codex execution concurrency must be an integer from 1 through 4",
    );
  }
  assert.equal(service.read(), 1);
});
