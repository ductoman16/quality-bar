import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";

class Element {
  /** @type {any[]} */
  children = [];
  /** @type {Map<string, (event: any) => unknown>} */
  listeners = new Map();
  textContent = "";
  type = "";

  /** @param {any} child */
  append(child) {
    this.children.push(child);
  }

  /** @param {string} name @param {(event: any) => unknown} listener */
  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  setAttribute() {}
}

test("rendered waiver operations keep Decision-error retry separate from recovery", async () => {
  /** @type {{options: any, path: string}[]} */
  const requests = [];
  const context = /** @type {any} */ ({
    crypto: { randomUUID: () => "retry-key" },
    document: { createElement: () => new Element() },
    fetch: async (/** @type {string} */ path, /** @type {any} */ options) => {
      requests.push({ options, path });
      return {
        async json() {
          return {
            adjudication: {
              execution_status: "queued",
              id: "adjudication-retry",
            },
          };
        },
        ok: true,
      };
    },
    window: {
      qualityBarOperator: {
        csrfToken: () => "csrf-token",
        displayMutationFailure: () => assert.fail("unexpected failure"),
      },
    },
  });
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/waiver-batch.js",
    readBrowserAsset("/assets/waiver-batch.js"),
    context,
  );
  const target = new Element();
  context.window.qualityBarWaiverBatch.renderAdjudications(
    target,
    "evaluation-1",
    [
      {
        decisions: [
          {
            error: { code: "evidence_unavailable", detail: "Unavailable." },
            id: "decision-error-1",
            outcome: "error",
            request_id: "request-1",
          },
          {
            error: { code: "evidence_unavailable", detail: "Unavailable." },
            id: "decision-error-2",
            outcome: "error",
            request_id: "request-2",
          },
        ],
        execution_status: "completed",
        id: "adjudication-completed",
        request_ids: ["request-1", "request-2"],
      },
      {
        decisions: [],
        error: { code: "process_failed", detail: "Codex failed." },
        execution_status: "failed",
        id: "adjudication-failed",
        request_ids: ["request-1"],
      },
    ],
  );
  assert.equal(
    target.children.at(-2).children[0].textContent,
    "Retry Waiver Adjudication",
  );
  const errorRetry = target.children.at(-1);
  assert.equal(errorRetry.children[1].textContent, "Retry errored waiver");
  errorRetry.children[0].children[0].checked = true;
  await errorRetry.listeners.get("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    {
      options: {
        body: JSON.stringify({ request_ids: ["request-2"] }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": "retry-key",
          "x-quality-bar-csrf": "csrf-token",
        },
        method: "POST",
      },
      path: "/api/v1/evaluations/evaluation-1/waiver-adjudications/error-retries",
    },
  ]);
});

test("Decision-error retry submits only operator-selected Requests", async () => {
  /** @type {any[]} */
  const bodies = [];
  const context = /** @type {any} */ ({
    crypto: { randomUUID: () => "retry-key" },
    document: { createElement: () => new Element() },
    fetch: async (/** @type {string} */ path, /** @type {any} */ options) => {
      assert.equal(
        path,
        "/api/v1/evaluations/evaluation-1/waiver-adjudications/error-retries",
      );
      bodies.push(JSON.parse(options.body));
      return {
        async json() {
          return {
            adjudication: {
              execution_status: "queued",
              id: "adjudication-retry",
            },
          };
        },
        ok: true,
      };
    },
    window: {
      qualityBarOperator: {
        csrfToken: () => "csrf-token",
        displayMutationFailure: () => assert.fail("unexpected failure"),
      },
    },
  });
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/waiver-batch.js",
    readBrowserAsset("/assets/waiver-batch.js"),
    context,
  );
  const form = context.window.qualityBarWaiverBatch.createErrorRetryForm(
    "evaluation-1",
    ["request-1", "request-2"],
  );
  form.children[1].children[0].checked = true;
  await form.listeners.get("submit")({ preventDefault() {} });
  assert.deepEqual(bodies, [{ request_ids: ["request-2"] }]);
});

test("historical failed recovery is hidden after a later Decision", () => {
  const context = /** @type {any} */ ({
    document: { createElement: () => new Element() },
    window: {},
  });
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/waiver-batch.js",
    readBrowserAsset("/assets/waiver-batch.js"),
    context,
  );
  const target = new Element();
  context.window.qualityBarWaiverBatch.renderAdjudications(
    target,
    "evaluation-1",
    [
      {
        decisions: [],
        error: { code: "process_failed", detail: "Codex failed." },
        execution_status: "failed",
        id: "adjudication-failed",
        request_ids: ["request-1"],
      },
      {
        decisions: [
          {
            error: { code: "evidence_unavailable", detail: "Unavailable." },
            id: "decision-error",
            outcome: "error",
            request_id: "request-1",
          },
        ],
        execution_status: "completed",
        id: "adjudication-completed",
        request_ids: ["request-1"],
      },
    ],
  );
  assert.equal(
    target.children.filter(
      (child) => child.children[0]?.textContent === "Retry Waiver Adjudication",
    ).length,
    0,
  );
});

test("exceptional recovery confirms its exact identity consequence before POST", async () => {
  /** @type {string[]} */
  const confirmations = [];
  const context = /** @type {any} */ ({
    document: { createElement: () => new Element() },
    fetch: () => assert.fail("cancelled recovery posted"),
    window: {
      confirm(/** @type {string} */ message) {
        confirmations.push(message);
        return false;
      },
    },
  });
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/waiver-batch.js",
    readBrowserAsset("/assets/waiver-batch.js"),
    context,
  );
  for (const mode of ["same_identity", "new_adjudication"]) {
    const form = context.window.qualityBarWaiverBatch.createRecoveryForm(
      "adjudication-1",
      mode,
    );
    await form.listeners.get("submit")({ preventDefault() {} });
  }
  assert.deepEqual(confirmations, [
    "Retry Waiver Adjudication adjudication-1? This will retry the same accepted Waiver Adjudication.",
    "Retry Waiver Adjudication adjudication-1? This will create a new Waiver Adjudication for its undecided Requests.",
  ]);
});
