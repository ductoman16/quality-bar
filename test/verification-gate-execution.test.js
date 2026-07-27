import assert from "node:assert/strict";
import { test } from "node:test";

import { runGate } from "../scripts/verification/gate-execution.mjs";

test("runGate maps injected command failures to verification failure detail", () => {
  const result = runGate(
    "/",
    {
      name: "commanded",
      failureCode: "commanded_failed",
      arguments: ["--test", "noop"],
      command: "node",
    },
    {
      commandExecutor: () => ({
        status: 1,
        stdout: "",
        stderr: "command executor failure\n",
        signal: null,
        error: undefined,
        pid: 1,
        output: ["command executor failure\n", ""],
      }),
    },
  );

  assert.equal(result.failure?.code, "commanded_failed");
  assert.equal(result.evidence.outcome, "fail");
  assert.equal(result.failure?.detail, "command executor failure");
});
