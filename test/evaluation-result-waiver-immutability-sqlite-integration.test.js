import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { readCompletedEvaluationResult } from "../src/evaluation/evaluation-result-read.js";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

test("waiver operations never alter the immutable Evaluation Result", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-result-waiver-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  seedCompletedEvaluation(core);
  const result = readCompletedEvaluationResult(core, "evaluation-1");
  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-1",
    createRequestId: () => "request-1",
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "waiver-key",
    request: {
      requests: [
        {
          finding_id: "finding-1",
          rationale: "Exact immutable exception rationale.",
        },
      ],
    },
  });
  assert.deepEqual(readCompletedEvaluationResult(core, "evaluation-1"), result);
});
