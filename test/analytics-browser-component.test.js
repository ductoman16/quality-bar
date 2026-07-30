import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import { browserElement } from "./repository-browser-component-support.js";

test("Analytics renders visible counts and numerator/denominator rates", () => {
  const page = operatorPage({ view: "analytics" });
  assert.match(page, /id="analytics-applicability"/);
  assert.match(page, /id="analytics-criteria"/);
  assert.match(page, /id="analytics-evaluation-outcomes"/);
  assert.match(page, /id="analytics-finding-impact"/);
  assert.match(page, /id="analytics-waivers"/);
  assert.match(page, /id="analytics-waiver-decisions"/);
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
  const error = browserElement({ hidden: true });
  const elements = new Map([
    ["analytics-applicability", applicability],
    ["analytics-criteria", criteria],
    ["analytics-evaluation-outcomes", evaluationOutcomes],
    ["analytics-finding-impact", findingImpact],
    ["analytics-waivers", waivers],
    ["analytics-waiver-decisions", waiverDecisions],
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
    "src/browser/analytics.js",
    readBrowserAsset("/assets/analytics.js"),
    context,
  );

  context.window.qualityBarAnalytics.render({
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
  });

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
  assert.equal(error.hidden, true);
});
