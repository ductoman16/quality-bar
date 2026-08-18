import assert from "node:assert/strict";
import { URL, URLSearchParams } from "node:url";
import { test } from "node:test";

import { operatorPage } from "../src/browser-pages.js";
import {
  assertEvaluationPage,
  evaluation,
  evaluationElements,
  executeEvaluationMonitorContract,
  executeEvaluationMonitorPageAsset,
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
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
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
    URL,
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
      if (path.startsWith("/api/v1/evaluations?")) {
        return response(collection);
      }
      if (path === "/api/v1/repositories") {
        return response({
          items: [
            {
              id: "repository-1",
              url: "https://example.invalid/repository.git",
            },
          ],
        });
      }
      if (path === "/api/v1/system") {
        return response({
          codex_execution: {
            concurrency: { maximum_running: 4, running_count: 2 },
            queue: { count: 3 },
          },
        });
      }
      if (path.startsWith("/api/v1/analytics?")) {
        return response({
          evaluation_overview: {
            p95_duration_ms: null,
            clear_rate: { denominator: 0, numerator: 0 },
          },
        });
      }
      if (path.endsWith("/cancel") || path.endsWith("/retry")) {
        return response({});
      }
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
                provider: "github",
                url: "https://example.invalid/repository.git",
                web_url: "https://github.com/example/repository",
              },
              {
                id: "c358ade1-1e17-4d5a-a88e-3af7666874ee",
                name: "repository",
                provider: "forgejo",
                url: "https://forgejo.example/operator/repository.git",
                web_url: "https://forgejo.example/operator/repository",
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
  // Outcome glyph shapes now live in the shared shell stylesheet
  // (`.qb-outcome-icon`, verified in secondary-shell-browser-component).
  // The evaluation page keeps only its timeline-node shapes.
  assert.match(page, /qb-timeline-node--pending.*border:1px dashed/);
  assert.match(page, /qb-timeline-node--advisory.*clip-path:polygon/);
  assert.match(
    page,
    /qb-timeline-node--blocking.*content:"";box-sizing:border-box.*border:1px solid.*center\/7px 7px no-repeat/,
  );
  assert.match(page, /qb-timeline-node--error.*content:"!".*border:0/);
  assert.match(page, /source-commit:first-child::after\{content:"→"/);
  assert.match(page, /source-pull-request\{font-weight:700\}/);
});

test("Evaluation outcomes use canonical outcome language", async () => {
  const cases = [
    ["clear", "completed", "clear", "Clear"],
    ["advisory", "completed", "advisory", "Advisory"],
    ["blocking", "completed", "blocking", "Blocking"],
    ["error", "completed", "error", "Error"],
  ];
  const fixture = monitorContext(
    cases.map(([outcome, execution, tone]) =>
      evaluation({
        effective_outcome: outcome,
        execution_status: execution,
        id: `evaluation-${outcome}-${execution}`,
        monitor: {
          ...evaluation().monitor,
          nodes: evaluation().monitor.nodes.map((node) =>
            node.kind === "review" ? { ...node, outcome: tone } : node,
          ),
        },
      }),
    ),
  );
  executeEvaluationMonitorPageAsset(fixture.context, "/assets/evaluation.js");
  await settle();
  const rows = fixture.controls.get("evaluation-list").options[0].options;
  for (const [outcome, execution, tone, label] of cases) {
    const row = rows.find(
      (/** @type {any} */ candidate) =>
        candidate["data-evaluation-id"] ===
        `evaluation-${outcome}-${execution}`,
    );
    const status = row.options[0].options[4];
    assert.match(status.className, new RegExp(`evaluation-status--${tone}`));
    assert.equal(status.options[1].textContent, label);
    assert.match(row.options[1].options[0].className, /--complete/);
    assert.match(
      row.options[1].options[2].className,
      new RegExp(`--${tone === "clear" ? "complete" : tone}`),
    );
    assert.equal(row.options[1].options[2]["aria-label"], `Security: ${label}`);
  }
});

test("Expanded review steps show their outcome in the shared vocabulary", async () => {
  const fixture = monitorContext([
    evaluation({
      effective_outcome: "advisory",
      id: "evaluation-advisory",
      monitor: {
        ...evaluation().monitor,
        nodes: evaluation().monitor.nodes.map((node) =>
          node.kind === "review" ? { ...node, outcome: "advisory" } : node,
        ),
      },
    }),
  ]);
  executeEvaluationMonitorPageAsset(fixture.context, "/assets/evaluation.js");
  await settle();
  await firstRow(fixture.controls).options[0].options[0].listener("click")();
  const preview = firstRow(fixture.controls).options.at(-1);
  // A completed system step reads its execution status ("Completed"); a review
  // step reads its outcome ("Advisory") in the same glyph vocabulary the row uses.
  const systemStep = preview.options[0].options[1].options[1];
  assert.match(systemStep.className, /evaluation-status--clear/);
  assert.equal(systemStep.options[1].textContent, "Completed");
  const reviewStep = preview.options[0].options[2].options[1];
  assert.match(reviewStep.className, /evaluation-status--advisory/);
  assert.equal(reviewStep.options[1].textContent, "Advisory");
});

test("Evaluation monitor interface validates resources and owns mutations", async () => {
  /** @type {Array<{options: any, path: string}>} */
  const requests = [];
  const context = {
    crypto: { randomUUID: () => "idempotency-key" },
    async fetch(/** @type {string} */ path, /** @type {any} */ options) {
      requests.push({ options, path });
      return response({});
    },
    window: {},
  };
  executeEvaluationMonitorContract(context);
  const monitor = /** @type {any} */ (context.window)
    .qualityBarEvaluationMonitor;
  assert.equal(monitor.validEvaluation(evaluation()), true);
  assert.equal(
    monitor.validCollection({ items: [evaluation()], next_cursor: null }),
    true,
  );
  assert.equal(
    monitor.validEvaluation({ ...evaluation(), monitor: { nodes: [] } }),
    false,
  );
  assert.equal(
    monitor.validEvaluation({
      ...evaluation(),
      monitor: {
        ...evaluation().monitor,
        review_counts: { ...evaluation().monitor.review_counts, total: 2 },
      },
    }),
    false,
  );
  assert.equal(monitor.isTerminalStatus("completed"), true);
  assert.equal(monitor.isTerminalStatus("running"), false);
  assert.equal(monitor.nodeVisualState({ status: "completed" }), "complete");
  assert.equal(
    monitor.nodeVisualState({ outcome: "blocking", status: "completed" }),
    "blocking",
  );
  assert.equal(
    monitor.nodeVisualState({ outcome: "advisory", status: "completed" }),
    "advisory",
  );
  assert.equal(monitor.nodeVisualState({ status: "failed" }), "error");
  await monitor.mutate({
    action: "retry",
    csrfToken: "csrf-token",
    evaluationId: "evaluation/1",
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/api/v1/evaluations/evaluation%2F1/retry");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(
    requests[0].options.headers["idempotency-key"],
    "idempotency-key",
  );
  assert.equal(requests[0].options.headers["x-quality-bar-csrf"], "csrf-token");
});

test("Evaluation monitor groups rows, uses monitor markers, filters, stats, actions, and no result fetches", async () => {
  const newest = evaluation({
    base_commit: "a".repeat(40),
    base_selector: { type: "commit", value: "a".repeat(40) },
    created_at: "2026-07-29T12:00:00.000Z",
    execution_status: "queued",
    head_commit: "b".repeat(40),
    head_selector: { type: "commit", value: "b".repeat(40) },
    id: "evaluation-running",
    provenance: "automatic",
    pull_request: { number: 344 },
    retry_state: "exhausted",
    repository: {
      id: "c358ade1-1e17-4d5a-a88e-3af7666874ee",
      url: "https://forgejo.example/operator/repository.git",
    },
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
          outcome: null,
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
  const fixture = monitorContext([
    evaluation({
      base_commit: "c".repeat(40),
      base_selector: { type: "commit", value: "c".repeat(40) },
      head_commit: "d".repeat(40),
      head_selector: { type: "commit", value: "d".repeat(40) },
    }),
    newest,
  ]);
  executeEvaluationMonitorPageAsset(fixture.context, "/assets/evaluation.js");
  await settle();

  const row = firstRow(fixture.controls);
  const summary = row.options[0];
  assert.equal(row["data-evaluation-id"], "evaluation-running");
  assert.equal(
    summary.options[1].href,
    "/?view=evaluation-detail&evaluation_id=evaluation-running",
  );
  assert.equal(summary.options[2].textContent, "repository");
  assert.equal(
    summary.options[2].href,
    "/?view=repository-detail&repository_id=c358ade1-1e17-4d5a-a88e-3af7666874ee",
  );
  assert.equal(summary.options[1].target, undefined);
  assert.equal(summary.options[2].target, undefined);
  assert.equal(
    summary.options[3].options[0].href,
    "https://forgejo.example/operator/repository/commit/" + "a".repeat(40),
  );
  assert.equal(
    summary.options[3].options[1].href,
    "https://forgejo.example/operator/repository/commit/" + "b".repeat(40),
  );
  assert.equal(
    summary.options[3].options[2].href,
    "https://forgejo.example/operator/repository/pulls/344",
  );
  assert.equal(summary.options[3].options[0].target, "_blank");
  assert.equal(summary.options[3].options[0].rel, "noopener");
  assert.equal(summary.options[3].options[1].target, "_blank");
  assert.equal(summary.options[3].options[2].target, "_blank");
  assert.equal(
    summary.options[3].options[2].className,
    "evaluation-row__source-pull-request",
  );
  assert.equal(
    summary.options[4].href,
    "/?view=evaluation-detail&evaluation_id=evaluation-running",
  );
  assert.equal(summary.options[4].target, undefined);
  const explicitSource =
    fixture.controls.get("evaluation-list").options[1].options[1].options[0]
      .options[3];
  assert.equal(
    explicitSource.options[0].href,
    "https://github.com/example/repository/commit/" + "c".repeat(40),
  );
  assert.equal(
    explicitSource.options[1].href,
    "https://github.com/example/repository/commit/" + "d".repeat(40),
  );
  assert.equal(explicitSource.options[2].textContent, "");
  assert.equal(explicitSource.options[2].href, undefined);
  assert.equal(
    row.options[1].className,
    "qb-timeline evaluation-row__timeline",
  );
  assert.match(row.options[1].options[0].className, /qb-timeline-node--system/);
  assert.match(row.options[1].options[2].className, /qb-timeline-node--review/);
  assert.match(row.options[1].options[2].className, /--running/);
  assert.match(row.options[1].options[4].className, /--pending/);
  assert.equal(
    fixture.controls.get("evaluation-stat-workers").textContent,
    "2 / 4",
  );
  assert.equal(fixture.controls.get("evaluation-stat-queue").textContent, "3");
  assert.equal(
    fixture.controls.get("evaluation-stat-clear-rate").textContent,
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
  // The expansion renders status in the shared `evaluation-status--` vocabulary
  // (not a separate glyph set): a completed system step reads "Completed", a
  // still-running review step (no outcome yet) reads "Running".
  const systemStepStatus = preview.options[0].options[1].options[1];
  assert.match(systemStepStatus.className, /evaluation-status--clear/);
  assert.equal(systemStepStatus.options[1].textContent, "Completed");
  const reviewStepStatus = preview.options[0].options[2].options[1];
  assert.match(reviewStepStatus.className, /evaluation-status--active/);
  assert.equal(reviewStepStatus.options[1].textContent, "Running");

  fixture.controls.get("evaluation-filter-status").value = "running";
  const filterStart = "2026-07-28T12:00";
  fixture.controls.get("evaluation-filter-start").value = filterStart;
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
  assert.match(
    filtered.path,
    new RegExp(`start=${new Date(filterStart).getTime()}`),
  );
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
  executeEvaluationMonitorPageAsset(fixture.context, "/assets/evaluation.js");
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
