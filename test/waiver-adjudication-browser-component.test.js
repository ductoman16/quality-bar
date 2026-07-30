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
  assert.equal(
    describeStatus({
      error: {
        code: "result_not_submitted",
        detail: " Exact failure detail retained. ",
      },
      execution_status: "failed",
      id: "adjudication-exact-failure",
    }),
    "Waiver Adjudication adjudication-exact-failure failed. Error result_not_submitted:  Exact failure detail retained. ",
  );
  assert.equal(
    describeStatus({
      decisions: [
        {
          explanation:
            "The inspected evidence proves this exact exception is justified.",
          id: "decision-accepted",
          outcome: "accepted",
          request_id: "request-accepted",
        },
        {
          explanation:
            "The rationale is uncertain and does not justify an exception.",
          id: "decision-denied",
          outcome: "denied",
          request_id: "request-denied",
        },
        {
          error: {
            code: "required_evidence_unavailable",
            detail: "The frozen generated file cannot be inspected.",
          },
          id: "decision-error",
          outcome: "error",
          request_id: "request-error",
        },
      ],
      execution_status: "completed",
      id: "adjudication-completed",
    }),
    "Waiver Adjudication adjudication-completed completed. Decisions: request-accepted accepted: The inspected evidence proves this exact exception is justified. request-denied denied: The rationale is uncertain and does not justify an exception. request-error error required_evidence_unavailable: The frozen generated file cannot be inspected.",
  );
  for (const invalidDecision of [
    {
      error: { code: " ", detail: "Exact detail." },
      id: "decision-error",
      outcome: "error",
      request_id: "request-error",
    },
    {
      error: { code: "required_evidence_unavailable", detail: " " },
      id: "decision-error",
      outcome: "error",
      request_id: "request-error",
    },
    {
      explanation: "Accepted.",
      id: " ",
      outcome: "accepted",
      request_id: "request-accepted",
    },
  ]) {
    assert.throws(
      () =>
        describeStatus({
          decisions: [invalidDecision],
          execution_status: "completed",
          id: "adjudication-invalid",
        }),
      /waiver_adjudication_invalid/,
    );
  }
});

test("the browser retries an errored immutable Request in a later Adjudication", async () => {
  /** @type {{path: string, options: any}[]} */
  const requests = [];
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
  const form = context.window.qualityBarWaiverBatch.createErrorRetryForm(
    "evaluation-1",
    ["request-error"],
  );
  form.children[0].children[0].checked = true;
  await form.listeners.get("submit")({ preventDefault() {} });

  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    {
      options: {
        body: JSON.stringify({ request_ids: ["request-error"] }),
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
  assert.equal(
    form.children[2].textContent,
    "Waiver Adjudication adjudication-retry queued.",
  );
});

test("the browser surfaces exact pre-start exhaustion and retries its Adjudication", async () => {
  /** @type {{path: string, options: any}[]} */
  const requests = [];
  /** @type {string[]} */
  const confirmations = [];
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
  const context = /** @type {any} */ ({
    crypto: { randomUUID: () => "recovery-key" },
    document: { createElement: () => new Element() },
    fetch: async (/** @type {string} */ path, /** @type {any} */ options) => {
      requests.push({ options, path });
      return {
        async json() {
          return {
            adjudication: {
              execution_status: "queued",
              id: "adjudication-exhausted",
            },
          };
        },
        ok: true,
      };
    },
    window: {
      confirm(/** @type {string} */ message) {
        confirmations.push(message);
        return true;
      },
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

  assert.equal(
    context.window.qualityBarWaiverBatch.describeStatus({
      execution_status: "queued",
      id: "adjudication-exhausted",
      pre_start_attempt_count: 3,
      retry_error: {
        code: "repository_git_read_failed",
        detail: "The frozen Repository could not be prepared.",
      },
      retry_state: "exhausted",
    }),
    "Waiver Adjudication adjudication-exhausted queued. Pre-start retry exhausted after 3 attempts. Error repository_git_read_failed: The frozen Repository could not be prepared.",
  );

  const form = context.window.qualityBarWaiverBatch.createRecoveryForm(
    "adjudication-exhausted",
    "same_identity",
  );
  await form.listeners.get("submit")({ preventDefault() {} });
  assert.deepEqual(confirmations, [
    "Retry Waiver Adjudication adjudication-exhausted? This will retry the same accepted Waiver Adjudication.",
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    {
      options: {
        headers: {
          "idempotency-key": "recovery-key",
          "x-quality-bar-csrf": "csrf-token",
        },
        method: "POST",
      },
      path: "/api/v1/waiver-adjudications/adjudication-exhausted/recover",
    },
  ]);
  assert.equal(
    form.children[1].textContent,
    "Waiver Adjudication adjudication-exhausted queued.",
  );
});

test("Evaluation detail renders exceptional recovery from canonical Adjudication state", async () => {
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
  const context = /** @type {any} */ ({
    document: { createElement: () => new Element() },
    window: {},
  });
  for (const asset of [
    "src/browser/waiver-batch.js",
    "src/browser/evaluation-result.js",
  ]) {
    executeServedBrowserAsset(
      resolve("."),
      asset,
      readBrowserAsset("/assets/" + asset.split("/").at(-1)),
      context,
    );
  }
  const target = new Element();
  await context.window.qualityBarEvaluationResult.render(
    target,
    { id: "evaluation-1" },
    {
      applicability_results: [],
      criterion_results: [],
      file_changes: [],
      findings: [],
      outcome: "advisory",
      review_runs: [],
    },
    "",
    [
      {
        completed_at: null,
        decisions: [],
        exhausted_at: "1970-01-01T00:00:00.020Z",
        execution_status: "queued",
        id: "adjudication-exhausted",
        next_attempt_at: null,
        pre_start_attempt_count: 3,
        request_ids: ["request-exhausted"],
        retry_cycle: 1,
        retry_error: {
          code: "review_run_checkout_failed",
          detail: "Waiver Adjudication checkout preparation failed",
        },
        retry_state: "exhausted",
        started_at: null,
      },
    ],
  );
  assert.equal(
    target.children.at(-2).textContent,
    "Waiver Adjudication adjudication-exhausted queued. Pre-start retry exhausted after 3 attempts. Error review_run_checkout_failed: Waiver Adjudication checkout preparation failed",
  );
  assert.equal(
    target.children.at(-1).children[0].textContent,
    "Retry Waiver Adjudication",
  );
});
