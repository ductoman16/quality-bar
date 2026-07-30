import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";

test("the browser preserves queued state and the exact owning execution failure", () => {
  const context = /** @type {any} */ ({ window: {} });
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/waiver-batch.js",
    readBrowserAsset("/assets/waiver-batch.js"),
    context,
  );
  const describeStatus = context.window.qualityBarWaiverBatch.describeStatus;
  assert.equal(
    describeStatus({
      execution_status: "queued",
      id: "adjudication-queued",
    }),
    "Waiver Adjudication adjudication-queued queued.",
  );
  assert.equal(
    describeStatus({
      error: {
        code: "result_not_submitted",
        detail: "Codex exited without an accepted Decision set",
      },
      execution_status: "failed",
      id: "adjudication-failed",
    }),
    "Waiver Adjudication adjudication-failed failed. Error result_not_submitted: Codex exited without an accepted Decision set",
  );
});
