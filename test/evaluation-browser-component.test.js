import assert from "node:assert/strict";
import { resolve } from "node:path";
import { URLSearchParams } from "node:url";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import {
  assertEvaluationPage,
  evaluation,
  evaluationElements,
} from "./evaluation-browser-component-support.js";
import { browserElement } from "./repository-browser-component-support.js";

/** @param {any} body @param {boolean} [ok] */
function response(body, ok = true) {
  return {
    ok,
    async json() {
      return body;
    },
  };
}

async function settle() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}
function monitorElement() {
  const value = browserElement();
  const append = value.append.bind(value);
  value.append = (.../** @type {any[]} */ children) => children.forEach(append);
  return value;
}

/** @param {any[]} items */
function monitorContext(items) {
  const controls = evaluationElements();
  /** @type {Map<string, (...args: any[]) => any>} */
  const documentListeners = new Map();
  /** @type {Map<string, (...args: any[]) => any>} */
  const windowListeners = new Map();
  /** @type {Array<{options: any, path: string}>} */
  const requests = [];
  /** @type {any[][]} */
  const history = [];
  /** @type {{items: any[], next_cursor: string | null}} */
  let collection = { items, next_cursor: null };
  const context = {
    crypto: { randomUUID: () => "idempotency-key" },
    URLSearchParams,
    document: {
      addEventListener(
        /** @type {string} */ name,
        /** @type {(...args: any[]) => any} */ listener,
      ) {
        documentListeners.set(name, listener);
      },
      createElement() {
        return monitorElement();
      },
      hidden: false,
    },
    fetch: async (
      /** @type {string} */ path,
      /** @type {any} */ options = {},
    ) => {
      requests.push({ options, path });
      if (path.startsWith("/api/v1/evaluations?")) return response(collection);
      if (path === "/api/v1/repositories")
        return response({
          items: [
            {
              id: "repository-1",
              url: "https://example.invalid/repository.git",
            },
          ],
        });
      if (path === "/api/v1/system")
        return response({
          codex_execution: {
            concurrency: { maximum_running: 4, running_count: 2 },
            queue: { count: 3 },
          },
        });
      if (path.startsWith("/api/v1/analytics?"))
        return response({
          evaluation_overview: {
            p95_duration_ms: null,
            pass_rate: { denominator: 0, numerator: 0 },
          },
        });
      if (path.endsWith("/cancel") || path.endsWith("/retry"))
        return response({});
      throw new Error(`unexpected request: ${path}`);
    },
    window: {
      addEventListener(
        /** @type {string} */ name,
        /** @type {(...args: any[]) => any} */ listener,
      ) {
        windowListeners.set(name, listener);
      },
      history: {
        /** @param {...any} args */
        replaceState(...args) {
          history.push(args);
        },
      },
      location: { search: "" },
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
          return controls.get(id);
        },
      },
      scrollY: 0,
      scrollTo() {},
    },
  };
  return {
    collection: (
      /** @type {{items: any[], next_cursor: string | null}} */ value,
    ) => {
      collection = value;
    },
    context,
    controls,
    documentListeners,
    history,
    requests,
    windowListeners,
  };
}

/** @param {Map<string, any>} controls */
function firstRow(controls) {
  return controls.get("evaluation-list").options[0].options[1];
}

test("Evaluation page has the live monitor structure and no result-renderer assets", () => {
  const page = operatorPage({ view: "evaluations" });
  assertEvaluationPage(page);
  assert.doesNotMatch(
    page,
    /Needs attention|id="evaluation-active"|id="evaluation-recent"/i,
  );
  assert.match(page, /aria-pressed="true" id="evaluation-stat-window-24h"/);
});

test("Evaluation monitor groups rows, uses monitor markers, filters, stats, actions, and no result fetches", async () => {
  const newest = evaluation({
    created_at: "2026-07-29T12:00:00.000Z",
    execution_status: "running",
    id: "evaluation-running",
    retry_state: "exhausted",
    monitor: {
      ...evaluation().monitor,
      duration_ms: null,
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
          review_version_id: "version-1",
          status: "running",
        },
        {
          key: "finalizing",
          kind: "system",
          label: "Finalizing",
          status: "queued",
        },
      ],
    },
  });
  const fixture = monitorContext([evaluation(), newest]);
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation.js",
    readBrowserAsset("/assets/evaluation.js"),
    fixture.context,
  );
  await settle();

  const row = firstRow(fixture.controls);
  assert.equal(row["data-evaluation-id"], "evaluation-running");
  assert.equal(
    row.options[1].className,
    "qb-timeline evaluation-row__timeline",
  );
  assert.match(row.options[1].options[0].className, /qb-timeline-node--system/);
  assert.match(row.options[1].options[2].className, /qb-timeline-node--review/);
  assert.equal(
    fixture.controls.get("evaluation-stat-workers").textContent,
    "2 / 4",
  );
  assert.equal(fixture.controls.get("evaluation-stat-queue").textContent, "3");
  assert.equal(
    fixture.controls.get("evaluation-stat-pass-rate").textContent,
    "No data",
  );
  assert.equal(
    fixture.controls.get("evaluation-stat-p95").textContent,
    "No data",
  );
  assert.ok(
    fixture.requests.every(
      ({ path }) => !/\/result|waiver|findings|diagnostics/.test(path),
    ),
  );

  await row.options[0].options[0].listener("click")();
  const expandedRow = firstRow(fixture.controls);
  const preview = expandedRow.options.at(-1);
  assert.equal(preview.className, "evaluation-expanded");
  assert.match(
    preview.options[0].options[0].options[0].className,
    /qb-timeline-node--system/,
  );
  assert.match(
    preview.options[1].options[0].options[0].className,
    /qb-timeline-node--review/,
  );

  fixture.controls.get("evaluation-filter-status").value = "running";
  fixture.controls.get("evaluation-filter-start").value = "2026-07-28T12:00";
  await fixture.controls.get("evaluation-filter-form").listener("submit")({
    preventDefault() {},
  });
  await settle();
  const filtered = fixture.requests.findLast(({ path }) =>
    path.startsWith("/api/v1/evaluations?"),
  );
  assert.ok(filtered);
  assert.match(filtered.path, /limit=50/);
  assert.match(filtered.path, /execution_status=running/);
  assert.match(filtered.path, /start=1785254400000/);
  const lastHistory = fixture.history.at(-1);
  assert.ok(lastHistory);
  assert.ok(lastHistory[2].includes("view=evaluations"));

  const actions = firstRow(fixture.controls).options.find(
    (/** @type {any} */ child) => child.className === "evaluation-actions",
  );
  assert.ok(actions);
  const cancel = actions.options[0];
  const retry = actions.options[1];
  await retry.listener("click")();
  assert.ok(
    fixture.requests.some(
      ({ path, options }) =>
        path === "/api/v1/evaluations/evaluation-running/retry" &&
        options.headers["idempotency-key"] === "idempotency-key" &&
        options.headers["x-quality-bar-csrf"] === "csrf-token",
    ),
  );
  await cancel.listener("click")();
  assert.ok(
    fixture.requests.some(
      ({ path, options }) =>
        path === "/api/v1/evaluations/evaluation-running/cancel" &&
        options.headers["x-quality-bar-csrf"] === "csrf-token",
    ),
  );
});

test("Evaluation monitor holds new polling activity behind an explicit cue", async () => {
  const initial = evaluation({ id: "evaluation-old" });
  const fixture = monitorContext([initial]);
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation.js",
    readBrowserAsset("/assets/evaluation.js"),
    fixture.context,
  );
  await settle();
  fixture.collection({
    items: [
      evaluation({
        created_at: "2026-07-29T12:00:00.000Z",
        id: "evaluation-new",
      }),
      initial,
    ],
    next_cursor: null,
  });
  const visibilityChange = fixture.documentListeners.get("visibilitychange");
  assert.ok(visibilityChange);
  await visibilityChange();
  await settle();
  assert.equal(fixture.controls.get("evaluation-new-activity").hidden, false);
  assert.equal(
    firstRow(fixture.controls)["data-evaluation-id"],
    "evaluation-old",
  );
  await fixture.controls.get("evaluation-new-activity").listener("click")();
  await settle();
  assert.equal(fixture.controls.get("evaluation-new-activity").hidden, true);
  assert.equal(
    firstRow(fixture.controls)["data-evaluation-id"],
    "evaluation-new",
  );
});
