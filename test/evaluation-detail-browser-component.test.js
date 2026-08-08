import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import { renderEvaluationMonitorPage } from "../src/evaluation-monitor-page.js";
import { executeEvaluationMonitorPageAsset } from "./evaluation-browser-component-support.js";
import { browserElement } from "./repository-browser-component-support.js";
/** @typedef {ReturnType<typeof browserElement>} BrowserElement */

function monitor() {
  return {
    duration_ms: 1_500,
    finding_counts: { advisory: 1, blocking: 0, total: 1 },
    nodes: [
      {
        key: "preparing",
        kind: "system",
        label: "Preparing",
        status: "completed",
      },
      {
        kind: "review",
        label: "Security",
        review_id: "review-1",
        review_version_id: "review-version-1",
        status: "completed",
      },
      {
        key: "finalizing",
        kind: "system",
        label: "Finalizing",
        status: "completed",
      },
    ],
    outcome_counts: { clear: 1, error: 0, not_applicable: 0, triggered: 1 },
    review_counts: {
      cancelled: 0,
      completed: 1,
      failed: 0,
      queued: 0,
      running: 0,
      total: 1,
    },
  };
}

function evaluation(overrides = {}) {
  return {
    completed_at: "2026-08-08T12:00:00.000Z",
    created_at: "2026-08-08T11:59:00.000Z",
    effective_outcome: "advisory",
    execution_status: "completed",
    id: "evaluation/detail one",
    monitor: monitor(),
    provenance: "explicit",
    repository: {
      id: "repository-1",
      url: "https://example.invalid/repository.git",
    },
    retry_state: "ready",
    ...overrides,
  };
}
/** @returns {Map<string, BrowserElement>} */

function controls() {
  return new Map(
    [
      ...renderEvaluationMonitorPage("evaluation-detail").markup.matchAll(
        /\bid="([^"]+)"/g,
      ),
    ].map(([, id]) => [id, browserElement({ hidden: true })]),
  );
}
/**
 * @param {Map<string, BrowserElement>} elements
 * @param {string} id
 */
function control(elements, id) {
  const value = elements.get(id);
  if (!value) {
    throw new Error("evaluation_detail_control_missing");
  }
  return value;
}

test("Evaluation detail has its own read-only shell and ordered monitor timeline", async () => {
  const page = operatorPage({
    evaluationId: "evaluation/detail one",
    view: "evaluation-detail",
  });
  const evaluationPage = renderEvaluationMonitorPage("evaluation-detail");
  assert.ok(page.includes(evaluationPage.markup));
  assert.ok(page.includes(evaluationPage.scripts));
  assert.doesNotMatch(page, /waiver-batch\.js/);

  const elements = controls();
  /** @type {string[]} */
  const requests = [];
  const context = {
    URLSearchParams,
    crypto: { randomUUID: () => "idempotency-key" },
    document: {
      getElementById(/** @type {string} */ id) {
        return elements.get(id) ?? null;
      },
      createElement() {
        return browserElement();
      },
      addEventListener() {},
      visibilityState: "visible",
    },
    fetch: async (/** @type {string} */ path) => {
      requests.push(path);
      if (path.endsWith("/result")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { outcome: "advisory" };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return evaluation();
        },
      };
    },
    window: {
      location: { search: "?evaluation_id=evaluation%2Fdetail%20one" },
      qualityBarEvaluationResult: {
        async render(
          /** @type {any} */ target,
          /** @type {any} */ value,
          /** @type {any} */ result,
          /** @type {string} */ search,
          /** @type {any[]} */ adjudications,
          /** @type {{ allowWaiverActions: boolean }} */ options,
        ) {
          assert.equal(target, control(elements, "evaluation-detail-result"));
          assert.equal(value.id, "evaluation/detail one");
          assert.equal(result.outcome, "advisory");
          assert.equal(search, "?evaluation_id=evaluation%2Fdetail%20one");
          assert.deepEqual(adjudications, []);
          assert.deepEqual(options, { allowWaiverActions: false });
        },
      },
      qualityBarOperator: { csrfToken: () => "csrf-token" },
      setInterval() {},
    },
  };
  executeEvaluationMonitorPageAsset(context, "/assets/evaluation-detail.js");
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  assert.deepEqual(requests, [
    "/api/v1/evaluations/evaluation%2Fdetail%20one",
    "/api/v1/evaluations/evaluation%2Fdetail%20one/result",
  ]);
  assert.equal(
    control(elements, "evaluation-detail-title").textContent,
    "Evaluation evaluation/detail one",
  );
  assert.equal(
    control(elements, "evaluation-detail-timeline").options.length,
    3,
  );
  assert.match(
    control(elements, "evaluation-detail-timeline").options[0].className,
    /--system/,
  );
  assert.match(
    control(elements, "evaluation-detail-timeline").options[1].className,
    /--review/,
  );
  assert.match(
    control(elements, "evaluation-detail-timeline").options[1].options[1]
      .textContent,
    /Review Security/,
  );
});

test("Evaluation detail reports a missing id without making a request", async () => {
  const elements = controls();
  let requests = 0;
  executeEvaluationMonitorPageAsset(
    {
      URLSearchParams,
      document: {
        getElementById(/** @type {string} */ id) {
          return elements.get(id) ?? null;
        },
        createElement: browserElement,
        addEventListener() {},
      },
      fetch: async () => {
        requests += 1;
        throw new Error("missing id must not fetch");
      },
      window: {
        location: { search: "" },
        qualityBarOperator: { csrfToken: () => "csrf-token" },
        setInterval() {},
      },
    },
    "/assets/evaluation-detail.js",
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(requests, 0);
  assert.equal(
    control(elements, "evaluation-detail-error").textContent,
    "An evaluation id is required",
  );
  assert.equal(control(elements, "evaluation-detail-error").hidden, false);
});

test("Read-only result rendering omits waiver controls and diagnostic requests", async () => {
  const target = browserElement();
  /** @type {any} */
  const context = {
    document: { createElement: browserElement },
    fetch: async () => {
      throw new Error("read-only result must not request diagnostics");
    },
    window: {},
  };
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation-result.js",
    readBrowserAsset("/assets/evaluation-result.js"),
    context,
  );
  await context.window.qualityBarEvaluationResult.render(
    target,
    { id: "evaluation-1" },
    {
      applicability_results: [],
      criterion_results: [
        {
          criterion_id: "criterion-1",
          outcome: "triggered",
          review_run_id: "run-1",
        },
      ],
      file_changes: [],
      findings: [
        {
          criterion_id: "criterion-1",
          evidence: "evidence",
          id: "finding-1",
          impact: "advisory",
          location: { kind: "changeset" },
          remediation: "remediation",
          review_run_id: "run-1",
        },
      ],
      outcome: "advisory",
      review_runs: [
        {
          id: "run-1",
          review_id: "review-1",
          review_version_id: "version-1",
          started_at: "2026-08-08T12:00:00.000Z",
        },
      ],
    },
    "",
    [],
    { allowWaiverActions: false },
  );
  const criterion = target.options[0];
  const finding = criterion.options.at(-1);
  assert.equal(
    finding.options.some((/** @type {any} */ node) => node.ariaLabel),
    false,
  );
});
