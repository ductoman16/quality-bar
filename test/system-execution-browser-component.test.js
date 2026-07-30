import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";

function element() {
  return /** @type {any} */ ({
    children: [],
    textContent: "",
    /** @param {any[]} children */
    replaceChildren(...children) {
      this.children = children;
    },
  });
}

test("System renders Codex queue facts as Evaluation and Waiver Adjudication resources", () => {
  const page = operatorPage({ view: "system" });
  assert.match(page, /<h2 id="codex-execution-title">Codex execution<\/h2>/);
  assert.match(page, /id="codex-execution-queue"/);
  assert.match(page, /id="codex-execution-running"/);
  assert.match(page, /id="codex-execution-failures"/);
  assert.match(page, /<script src="\/assets\/system-execution\.js"><\/script>/);
  assert.doesNotMatch(page, /\bJob\b/);

  const controls = new Map(
    [
      "codex-execution-concurrency",
      "codex-execution-queue",
      "codex-execution-running",
      "codex-execution-failures",
    ].map((id) => [id, element()]),
  );
  /** @type {((event: {detail: unknown}) => void) | null} */
  let loaded = null;
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/system-execution.js",
    readBrowserAsset("/assets/system-execution.js"),
    {
      document: {
        /** @param {string} name @param {(event: {detail: unknown}) => void} listener */
        addEventListener(name, listener) {
          if (name === "quality-bar:system-loaded") {
            loaded = listener;
          }
        },
        createElement: () => element(),
        /** @param {string} id */
        getElementById(id) {
          return controls.get(id) ?? null;
        },
      },
    },
  );
  if (!loaded) {
    throw new Error("system_execution_listener_missing");
  }
  /** @type {(event: {detail: unknown}) => void} */
  const systemLoaded = /** @type {any} */ (loaded);
  systemLoaded({
    detail: {
      codex_execution: {
        concurrency: {
          maximum_running: 1,
          running_count: 1,
          start_gate: "no_new_start",
        },
        failures: [
          {
            completed_at: "2026-07-30T12:00:00.000Z",
            error: {
              code: "unexpected_execution_failure",
              detail: "Exact failure.",
            },
            waiver_adjudication_id: "adjudication-failed",
          },
        ],
        queue: {
          count: 1,
          rows: [
            {
              evaluation_id: "evaluation-1",
              execution_status: "queued",
              gate: { code: "retry_exhausted" },
              lease: {
                expires_at: null,
                fencing_token: 0,
                status: "unclaimed",
                worker_id: null,
              },
              next_attempt_at: null,
              pre_start_attempt_count: 2,
              queue_position: 1,
              retry_cycle: 1,
              retry_error: {
                code: "review_run_checkout_failed",
                detail: "Checkout failed.",
              },
              retry_state: "exhausted",
              review_run_id: "review-run-1",
            },
          ],
        },
        running: {
          count: 1,
          rows: [
            {
              execution_status: "running",
              gate: { code: "running" },
              lease: {
                expires_at: "2026-07-30T12:02:00.000Z",
                fencing_token: 3,
                status: "running",
                worker_id: "worker-a",
              },
              pre_start_attempt_count: 0,
              retry_cycle: 1,
              retry_error: null,
              retry_state: "ready",
              waiver_adjudication_id: "adjudication-running",
            },
          ],
        },
      },
    },
  });
  assert.deepEqual(
    controls
      .get("codex-execution-concurrency")
      ?.children.map(
        (/** @type {{textContent: string}} */ child) => child.textContent,
      ),
    ["Maximum running", "1", "Running", "1", "Start gate", "no_new_start"],
  );
  assert.match(
    controls.get("codex-execution-queue")?.children[0].textContent,
    /Evaluation evaluation-1; Review Run review-run-1\. Queue position 1\..*Next attempt none\./,
  );
  assert.match(
    controls.get("codex-execution-running")?.children[0].textContent,
    /Waiver Adjudication adjudication-running\. State running\./,
  );
  assert.match(
    controls.get("codex-execution-failures")?.children[0].textContent,
    /Failure unexpected_execution_failure: Exact failure\./,
  );
});
