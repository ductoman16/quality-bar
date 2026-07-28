import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import { browserElement } from "./repository-browser-component-support.js";

/** @param {string} digit */
const oid = (digit) => digit.repeat(40);
/** @param {Record<string, unknown>} [overrides] */
const evaluation = (overrides = {}) => ({
  base_commit: oid("1"),
  base_selector: { type: "branch", value: "main" },
  completed_at: "2026-07-28T12:00:00.000Z",
  created_at: "2026-07-28T12:00:00.000Z",
  effective_outcome: "clear",
  execution_status: "completed",
  head_commit: oid("2"),
  head_selector: { type: "branch", value: "topic" },
  id: "evaluation-complete",
  next_attempt_at: null,
  provenance: "explicit",
  repository: {
    id: "repository-1",
    url: "https://example.invalid/repository.git",
  },
  ...overrides,
});

function elements() {
  return /** @type {any} */ (
    new Map(
      [
        "evaluation-create-form",
        "evaluation-repository",
        "evaluation-base-type",
        "evaluation-base-value",
        "evaluation-head-type",
        "evaluation-head-value",
        "evaluation-loading",
        "evaluation-empty",
        "evaluation-state",
        "evaluation-active",
        "evaluation-recent",
        "evaluation-attention",
        "evaluation-more",
        "evaluation-create-status",
      ].map((id) => [id, browserElement({ hidden: true })]),
    )
  );
}

test("Evaluations is the default workspace and renders frozen work, distinct states, and the complete Result", async () => {
  const page = operatorPage({ view: "evaluations" });
  assert.match(page, /<h1>Evaluations<\/h1>/);
  assert.match(page, /id="evaluation-create-form"/);
  assert.match(page, /id="evaluation-active"/);
  assert.match(page, /id="evaluation-recent"/);
  assert.match(page, /id="evaluation-attention"/);
  assert.match(page, /id="evaluation-more"/);
  assert.match(page, /<script src="\/assets\/evaluation\.js"><\/script>/);
  assert.equal(
    operatorPage({ view: "evaluations" }),
    operatorPage({ view: "evaluations" }),
  );

  const controls = elements();
  controls.get("evaluation-base-type").value = "branch";
  controls.get("evaluation-base-value").value = "main";
  controls.get("evaluation-head-type").value = "branch";
  controls.get("evaluation-head-value").value = "topic";
  /** @type {Array<{options: any, path: string}>} */
  const requests = [];
  const context = {
    crypto: { randomUUID: () => "browser-idempotency-key" },
    document: {
      createElement() {
        return browserElement();
      },
    },
    async fetch(/** @type {string} */ path, /** @type {any} */ options) {
      requests.push({ options, path });
      if (path === "/api/v1/evaluations") {
        return {
          ok: true,
          async json() {
            return {
              items: [
                evaluation(),
                evaluation({
                  base_selector: { type: "branch", value: "failure" },
                  id: "evaluation-result-failure",
                }),
                evaluation({
                  completed_at: null,
                  effective_outcome: "pending",
                  execution_status: "queued",
                  id: "evaluation-delayed",
                  next_attempt_at: "2026-07-28T12:05:00.000Z",
                }),
                evaluation({
                  completed_at: null,
                  effective_outcome: "pending",
                  execution_status: "queued",
                  id: "evaluation-not-ready",
                }),
                evaluation({
                  effective_outcome: "error",
                  execution_status: "failed",
                  id: "evaluation-failed",
                }),
              ],
              next_cursor: "cursor-2",
            };
          },
        };
      }
      if (path === "/api/v1/evaluations?cursor=cursor-2") {
        return {
          ok: true,
          async json() {
            return {
              items: [
                evaluation({
                  effective_outcome: "error",
                  execution_status: "cancelled",
                  id: "evaluation-older",
                }),
              ],
              next_cursor: null,
            };
          },
        };
      }
      if (path === "/api/v1/evaluations/evaluation-complete/result") {
        return {
          ok: true,
          async json() {
            return {
              applicability_results: [],
              completed_at: "2026-07-28T12:00:00.000Z",
              criterion_results: [],
              evaluation_id: "evaluation-complete",
              findings: [],
              outcome: "clear",
              review_runs: [],
            };
          },
        };
      }
      if (path === "/api/v1/evaluations/evaluation-result-failure/result") {
        throw new Error("simulated Result transport failure");
      }
      if (path === "/api/v1/repositories/repository-1/evaluations") {
        return {
          ok: true,
          async json() {
            return evaluation({ id: "evaluation-created" });
          },
        };
      }
      throw new Error(`unexpected fetch: ${path}`);
    },
    window: {
      qualityBarOperator: {
        csrfToken: () => "csrf-token",
        async displayMutationFailure() {},
        async readRepositoryCollection() {
          return {
            failure: null,
            items: [
              {
                id: "repository-1",
                url: "https://example.invalid/repository.git",
              },
            ],
          };
        },
        requiredElement(/** @type {string} */ id) {
          const element = controls.get(id);
          if (!element) {
            throw new Error(`missing element: ${id}`);
          }
          return element;
        },
      },
    },
  };
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation.js",
    readBrowserAsset("/assets/evaluation.js"),
    context,
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  assert.equal(controls.get("evaluation-loading").hidden, true);
  assert.equal(controls.get("evaluation-empty").hidden, true);
  assert.match(
    controls.get("evaluation-recent").options[0].textContent,
    /explicit branch main \(1111.*\) → branch topic \(2222.*\) — completed — clear/,
  );
  assert.match(
    controls.get("evaluation-recent").options[0].options[0].textContent,
    /"evaluation_id":"evaluation-complete".*"outcome":"clear"/,
  );
  assert.match(
    controls.get("evaluation-recent").options[1].textContent,
    /branch failure/,
  );
  assert.equal(
    controls.get("evaluation-recent").options[1].options[0].textContent,
    "Result failed to load",
  );
  assert.match(
    controls.get("evaluation-active").options[0].textContent,
    /delayed until 2026-07-28T12:05:00.000Z — pending/,
  );
  assert.equal(
    controls.get("evaluation-active").options[0].options[0].textContent,
    "Result not ready",
  );
  assert.match(
    controls.get("evaluation-active").options[1].textContent,
    /queued — pending/,
  );
  assert.equal(
    controls.get("evaluation-active").options[1].options[0].textContent,
    "Result not ready",
  );
  assert.match(
    controls.get("evaluation-attention").options[0].textContent,
    /failed — error/,
  );
  assert.equal(controls.get("evaluation-more").hidden, false);
  await controls.get("evaluation-more").listener("click")();
  assert.equal(controls.get("evaluation-more").hidden, true);
  assert.match(
    controls.get("evaluation-attention").options[1].textContent,
    /cancelled — error/,
  );
  assert.ok(
    requests.some(({ path }) => path === "/api/v1/evaluations?cursor=cursor-2"),
  );

  controls.get("evaluation-repository").value = "repository-1";
  await controls.get("evaluation-create-form").listener("submit")({
    preventDefault() {},
  });
  assert.ok(
    requests.filter(({ path }) => path === "/api/v1/evaluations").length >= 2,
  );
  const creation = requests.find(
    ({ path }) => path === "/api/v1/repositories/repository-1/evaluations",
  );
  assert.deepEqual(JSON.parse(JSON.stringify(creation)), {
    options: {
      body: JSON.stringify({
        base: { type: "branch", value: "main" },
        head: { type: "branch", value: "topic" },
      }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "browser-idempotency-key",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "POST",
    },
    path: "/api/v1/repositories/repository-1/evaluations",
  });
  assert.equal(
    controls.get("evaluation-create-status").textContent,
    "Evaluation evaluation-created completed.",
  );
});

test("Evaluations distinguishes an empty workspace from a hard dependency gate", async () => {
  for (const scenario of ["empty", "gated"]) {
    const controls = elements();
    const context = {
      document: {
        createElement() {
          return browserElement();
        },
      },
      async fetch(/** @type {string} */ path) {
        assert.equal(path, "/api/v1/evaluations");
        return scenario === "empty"
          ? {
              ok: true,
              async json() {
                return { items: [], next_cursor: null };
              },
            }
          : {
              ok: false,
              status: 503,
              async json() {
                return {
                  error: {
                    message:
                      "A required runtime filesystem is below the free-space reserve",
                  },
                };
              },
            };
      },
      window: {
        qualityBarOperator: {
          csrfToken: () => "csrf-token",
          async displayMutationFailure() {},
          async readRepositoryCollection() {
            return { failure: null, items: [] };
          },
          requiredElement(/** @type {string} */ id) {
            return controls.get(id);
          },
        },
      },
    };
    executeServedBrowserAsset(
      resolve("."),
      "src/browser/evaluation.js",
      readBrowserAsset("/assets/evaluation.js"),
      context,
    );
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    if (scenario === "empty") {
      assert.equal(controls.get("evaluation-empty").hidden, false);
      assert.equal(controls.get("evaluation-state").hidden, true);
    } else {
      assert.equal(controls.get("evaluation-empty").hidden, true);
      assert.equal(controls.get("evaluation-state").hidden, false);
      assert.equal(
        controls.get("evaluation-state").textContent,
        "Evaluations unavailable: A required runtime filesystem is below the free-space reserve",
      );
    }
  }
});
