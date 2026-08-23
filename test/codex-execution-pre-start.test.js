import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_PRE_START_ATTEMPT_LIMIT,
  CODEX_PRE_START_RETRY_DELAYS,
  isTransientCodexPreStartFailure,
} from "../src/codex/codex-execution-pre-start.js";

test("accepted Codex work uses the initial, one-minute, and five-minute pre-start attempts", () => {
  assert.equal(CODEX_PRE_START_ATTEMPT_LIMIT, 3);
  assert.deepEqual(CODEX_PRE_START_RETRY_DELAYS, [60_000, 300_000]);
});

test("only temporary checkout preparation uses the timed pre-start budget", () => {
  assert.equal(
    isTransientCodexPreStartFailure(
      Object.assign(new Error("Checkout preparation failed"), {
        code: "review_run_checkout_failed",
      }),
    ),
    true,
  );
  assert.equal(
    isTransientCodexPreStartFailure(
      Object.assign(new Error("Quality Bar is shutting down"), {
        code: "application_shutting_down",
      }),
    ),
    true,
  );
  for (const code of [
    "repository_permission_denied",
    "codex_authentication_unavailable",
    "review_run_checkout_failed_definitive",
  ]) {
    assert.equal(
      isTransientCodexPreStartFailure(
        Object.assign(new Error("Definitive pre-start failure"), { code }),
      ),
      false,
    );
  }
});
