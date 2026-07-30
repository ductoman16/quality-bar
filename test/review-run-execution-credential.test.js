import assert from "node:assert/strict";
import test from "node:test";

import { createIoExecutionPool } from "../src/io-execution-pool.js";
import { executeReviewRun } from "../src/review-run-execution.js";

test("credential acquisition failure stays inside the claimed execution lifecycle", async () => {
  const failure = Object.assign(new Error("credential failed exactly"), {
    code: "repository_git_credentials_unavailable",
  });
  let stoppedRenewal = false;
  await assert.rejects(
    executeReviewRun(
      {
        all: () => [
          {
            criterion_id: "criterion-1",
            impact: "blocking",
            instruction: "Reject broken changes",
          },
        ],
        get: () => ({
          base_commit: "a".repeat(40),
          execution_status: "queued",
          head_commit: "b".repeat(40),
          model: "gpt-5.3-codex",
          name: "Correctness",
          normalized_url: "https://example.test/repository.git",
          reasoning_effort: "high",
          service_tier: "priority",
        }),
      },
      { fencingToken: 1, workerId: "worker-1", workId: "run-1" },
      {
        acquireCheckoutCredential() {
          throw failure;
        },
        claimService: {
          startTracked: assert.fail,
          startRenewal() {
            return () => {
              stoppedRenewal = true;
            };
          },
        },
        ioPool: createIoExecutionPool(),
        prepareCheckout: () => assert.fail("checkout must not start"),
        readFileChanges: assert.fail,
        resultService: { fail: assert.fail, prepare: assert.fail },
        runCodex: async () => assert.fail("Codex must not start"),
      },
    ),
    (error) => error === failure,
  );
  assert.equal(stoppedRenewal, true);
});
