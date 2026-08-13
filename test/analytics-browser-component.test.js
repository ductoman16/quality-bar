import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import { browserElement } from "./repository-browser-component-support.js";
import {
  analyticsMatchingFactsFixture,
  assertAnalyticsBrowserStates,
} from "./analytics-browser-state-support.js";

test("Analytics renders visible counts and numerator/denominator rates", () => {
  const page = operatorPage({ view: "analytics" });
  assert.match(page, /id="analytics-applicability"/);
  assert.match(page, /id="analytics-criteria"/);
  assert.match(page, /id="analytics-evaluation-outcomes"/);
  assert.match(page, /id="analytics-finding-impact"/);
  assert.match(page, /id="analytics-waivers"/);
  assert.match(page, /id="analytics-waiver-decisions"/);
  assert.match(page, /id="analytics-review-run-reliability"/);
  assert.match(page, /id="analytics-waiver-adjudication-reliability"/);
  assert.match(page, /id="analytics-execution-failure-codes"/);
  assert.match(page, /id="analytics-execution-duration"/);
  assert.match(page, /id="analytics-token-counters"/);
  assert.match(page, /id="analytics-filters"/);
  assert.match(page, /id="analytics-population"/);
  assert.match(page, /id="analytics-transitions"/);
  assert.match(page, /id="analytics-matching-evaluations"/);
  assert.match(page, /id="analytics-matching-review-runs"/);
  assert.match(
    page,
    /<script src="\/assets\/analytics-contract\.js"><\/script>/,
  );
  assert.match(
    page,
    /<script src="\/assets\/analytics-matching-facts\.js"><\/script>/,
  );
  assert.match(page, /<script src="\/assets\/analytics-state\.js"><\/script>/);
  assert.match(page, /<script src="\/assets\/analytics\.js"><\/script>/);
  const labels = [...page.matchAll(/<th>([^<]+)<\/th>/g)].map(
    ([, label]) => label,
  );
  assert.equal(new Set(labels).size, labels.length);

  const applicability = browserElement();
  const criteria = browserElement();
  const evaluationOutcomes = browserElement();
  const findingImpact = browserElement();
  const waivers = browserElement();
  const waiverDecisions = browserElement();
  const reviewRunReliability = browserElement();
  const waiverAdjudicationReliability = browserElement();
  const executionFailureCodes = browserElement();
  const executionDuration = browserElement();
  const tokenCounters = browserElement();
  const transitions = browserElement();
  const matchingEvaluations = browserElement();
  const matchingReviewRuns = browserElement();
  const population = browserElement();
  const filters = browserElement();
  const error = browserElement({ hidden: true });
  const elements = new Map([
    ["analytics-applicability", applicability],
    ["analytics-criteria", criteria],
    ["analytics-evaluation-outcomes", evaluationOutcomes],
    ["analytics-finding-impact", findingImpact],
    ["analytics-waivers", waivers],
    ["analytics-waiver-decisions", waiverDecisions],
    ["analytics-review-run-reliability", reviewRunReliability],
    [
      "analytics-waiver-adjudication-reliability",
      waiverAdjudicationReliability,
    ],
    ["analytics-execution-failure-codes", executionFailureCodes],
    ["analytics-execution-duration", executionDuration],
    ["analytics-token-counters", tokenCounters],
    ["analytics-transitions", transitions],
    ["analytics-matching-evaluations", matchingEvaluations],
    ["analytics-matching-review-runs", matchingReviewRuns],
    ["analytics-population", population],
    ["analytics-filters", filters],
    ["analytics-error", error],
  ]);
  const context = /** @type {any} */ ({
    document: {
      createElement() {
        return browserElement();
      },
      /** @param {string} id */
      getElementById(id) {
        return elements.get(id) ?? null;
      },
    },
    window: {},
  });
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/analytics-contract.js",
    readBrowserAsset("/assets/analytics-contract.js"),
    context,
  );
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/analytics-state.js",
    readBrowserAsset("/assets/analytics-state.js"),
    context,
  );
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/analytics-matching-facts.js",
    readBrowserAsset("/assets/analytics-matching-facts.js"),
    context,
  );
  assert.throws(
    () =>
      executeServedBrowserAsset(
        resolve("."),
        "src/browser/analytics.js",
        readBrowserAsset("/assets/analytics.js"),
        {
          ...context,
          document: {
            ...context.document,
            /** @param {string} id */
            getElementById(id) {
              return id === "analytics-filters"
                ? null
                : context.document.getElementById(id);
            },
          },
          window: { ...context.window },
        },
      ),
    { message: "analytics_filter_surface_missing" },
  );
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/analytics.js",
    readBrowserAsset("/assets/analytics.js"),
    context,
  );

  const analyticsDocument = {
    criterion_outcomes: [
      {
        clear: 3,
        clear_rate: { denominator: 5, numerator: 3 },
        criterion_id: "criterion-1",
        error: 1,
        error_rate: { denominator: 8, numerator: 1 },
        not_applicable: 2,
        not_applicable_rate: { denominator: 8, numerator: 2 },
        trigger_rate: { denominator: 5, numerator: 2 },
        triggered: 2,
      },
    ],
    evaluation_outcomes: {
      advisory: 2,
      advisory_rate: { denominator: 8, numerator: 2 },
      blocking: 1,
      blocking_rate: { denominator: 8, numerator: 1 },
      clear: 4,
      clear_rate: { denominator: 8, numerator: 4 },
      error: 1,
      error_rate: { denominator: 8, numerator: 1 },
      pending: 3,
    },
    finding_impact: {
      advisory: 5,
      blocking: 2,
      findings_per_triggered_criterion_result: {
        denominator: 4,
        numerator: 7,
      },
    },
    matching_facts: analyticsMatchingFactsFixture(),
    population: {
      filters: {},
      matching_evaluations: 11,
      matching_waiver_adjudications: 1,
      matching_waiver_decisions: 5,
      matching_waiver_requests: 3,
      pending_adjudications: 1,
      pending_evaluations: 3,
      state: "pending_data",
      total_evaluations: 11,
    },
    pull_request_criterion_transitions: {
      no_longer_applicable: 1,
      sample_size: 4,
      triggered_to_clear: 2,
      triggered_to_error: 1,
    },
    review_applicability: [
      {
        applicable: 4,
        applicability_rate: { denominator: 5, numerator: 4 },
        error: 2,
        error_rate: { denominator: 7, numerator: 2 },
        not_applicable: 1,
        review_id: "review-1",
      },
    ],
    review_run_reliability: {
      active: 2,
      duration: {
        failed: { execution_count: 1, median_ms: 300, total_ms: 300 },
        operator_cancelled: {
          execution_count: 1,
          median_ms: 400,
          total_ms: 400,
        },
        successful: { execution_count: 1, median_ms: 100, total_ms: 100 },
        superseded: { execution_count: 0, median_ms: null, total_ms: null },
        terminal: { execution_count: 3, median_ms: 300, total_ms: 800 },
      },
      failed: 1,
      failed_rate: { denominator: 3, numerator: 1 },
      failure_codes: [{ code: "codex_process_failed", count: 1 }],
      operator_cancelled: 1,
      operator_cancelled_rate: { denominator: 3, numerator: 1 },
      successful: 1,
      successful_rate: { denominator: 3, numerator: 1 },
      superseded: 0,
      superseded_rate: { denominator: 3, numerator: 0 },
      token_counters: {
        cached_input_tokens: {
          coverage: { denominator: 3, numerator: 0 },
          median: null,
          sum: null,
        },
        input_tokens: {
          coverage: { denominator: 3, numerator: 2 },
          median: 15,
          sum: 30,
        },
        output_tokens: {
          coverage: { denominator: 3, numerator: 2 },
          median: 4,
          sum: 8,
        },
      },
    },
    waiver_analytics: {
      advisory_findings: 5,
      decision_history: {
        accepted: 2,
        accepted_rate: { denominator: 5, numerator: 2 },
        denied: 2,
        denied_rate: { denominator: 5, numerator: 2 },
        error: 1,
        error_rate: { denominator: 5, numerator: 1 },
      },
      requested_findings: 3,
      waived_findings: 2,
      waived_finding_rate: { denominator: 5, numerator: 2 },
      waiver_request_rate: { denominator: 5, numerator: 3 },
    },
    waiver_adjudication_reliability: {
      active: 1,
      cancelled: 1,
      cancelled_rate: { denominator: 3, numerator: 1 },
      completed: 1,
      completed_rate: { denominator: 3, numerator: 1 },
      duration: {
        cancelled: { execution_count: 1, median_ms: 300, total_ms: 300 },
        completed: { execution_count: 1, median_ms: 100, total_ms: 100 },
        failed: { execution_count: 1, median_ms: 200, total_ms: 200 },
        terminal: { execution_count: 3, median_ms: 200, total_ms: 600 },
      },
      failed: 1,
      failed_rate: { denominator: 3, numerator: 1 },
      failure_codes: [{ code: "codex_process_failed", count: 1 }],
      token_counters: {
        cached_input_tokens: {
          coverage: { denominator: 3, numerator: 1 },
          median: 3,
          sum: 3,
        },
        input_tokens: {
          coverage: { denominator: 3, numerator: 1 },
          median: 6,
          sum: 6,
        },
        output_tokens: {
          coverage: { denominator: 3, numerator: 2 },
          median: 6,
          sum: 12,
        },
      },
    },
  };
  context.window.qualityBarAnalytics.render(analyticsDocument);

  assert.deepEqual(
    applicability.options[0].options.map(
      (/** @type {{textContent: string}} */ { textContent }) => textContent,
    ),
    ["review-1", "4", "1", "2", "4/5", "2/7"],
  );
  assert.deepEqual(
    criteria.options[0].options.map(
      (/** @type {{textContent: string}} */ { textContent }) => textContent,
    ),
    ["criterion-1", "2", "3", "2", "1", "2/5", "3/5", "2/8", "1/8"],
  );
  assert.deepEqual(
    evaluationOutcomes.options[0].options.map(
      (/** @type {{textContent: string}} */ { textContent }) => textContent,
    ),
    ["4", "2", "1", "1", "3", "4/8", "2/8", "1/8", "1/8"],
  );
  assert.deepEqual(
    findingImpact.options[0].options.map(
      (/** @type {{textContent: string}} */ { textContent }) => textContent,
    ),
    ["5", "2", "7/4"],
  );
  assert.deepEqual(
    waivers.options[0].options.map(
      (/** @type {{textContent: string}} */ { textContent }) => textContent,
    ),
    ["5", "3", "3/5", "2", "2/5"],
  );
  assert.deepEqual(
    waiverDecisions.options[0].options.map(
      (/** @type {{textContent: string}} */ { textContent }) => textContent,
    ),
    ["2", "2", "1", "2/5", "2/5", "1/5"],
  );
  assert.deepEqual(
    reviewRunReliability.options[0].options.map(
      (/** @type {{textContent: string}} */ { textContent }) => textContent,
    ),
    ["1", "1", "1", "0", "2", "1/3", "1/3", "1/3", "0/3"],
  );
  assert.deepEqual(
    waiverAdjudicationReliability.options[0].options.map(
      (/** @type {{textContent: string}} */ { textContent }) => textContent,
    ),
    ["1", "1", "1", "1", "1/3", "1/3", "1/3"],
  );
  assert.deepEqual(
    executionFailureCodes.options.map(
      (/** @type {{options: {textContent: string}[]}} */ item) =>
        item.options.map(({ textContent }) => textContent),
    ),
    [
      ["Review Run", "codex_process_failed", "1"],
      ["Waiver Adjudication", "codex_process_failed", "1"],
    ],
  );
  assert.deepEqual(
    executionDuration.options[0].options.map(
      (/** @type {{textContent: string}} */ { textContent }) => textContent,
    ),
    ["Review Run", "Terminal", "3", "800", "300"],
  );
  assert.deepEqual(
    tokenCounters.options[0].options.map(
      (/** @type {{textContent: string}} */ { textContent }) => textContent,
    ),
    ["Review Run", "Input tokens", "30", "15", "2/3"],
  );
  assert.deepEqual(
    tokenCounters.options[1].options.map(
      (/** @type {{textContent: string}} */ { textContent }) => textContent,
    ),
    ["Review Run", "Cached input tokens", "—", "—", "0/3"],
  );
  assert.equal(
    population.textContent,
    "Pending data · 11/11 Evaluations · 3 Waiver Requests · 5 Waiver Decisions · 1 Waiver Adjudications",
  );
  assert.equal(matchingEvaluations.options.length, 1);
  assert.equal(matchingReviewRuns.options.length, 1);
  assert.deepEqual(
    transitions.options[0].options.map(
      (/** @type {{textContent: string}} */ { textContent }) => textContent,
    ),
    ["2", "1", "1", "4"],
  );
  assertAnalyticsBrowserStates({
    analyticsDocument,
    context,
    error,
    evaluationOutcomes,
    matchingEvaluations,
    page,
    population,
  });
});
