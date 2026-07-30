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
  assert.match(page, /<script src="\/assets\/analytics\.js"><\/script>/);

  const applicability = browserElement();
  const criteria = browserElement();
  const error = browserElement({ hidden: true });
  const elements = new Map([
    ["analytics-applicability", applicability],
    ["analytics-criteria", criteria],
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
  assert.equal(error.hidden, true);
});
