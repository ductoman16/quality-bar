import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { browserElement } from "./repository-browser-component-support.js";

test("Evaluation Results expose each Applicability outcome with its owning scope and error", () => {
  const target = browserElement();
  const context = /** @type {any} */ ({
    document: {
      createElement() {
        return browserElement();
      },
    },
    window: {},
  });
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation-result.js",
    readBrowserAsset("/assets/evaluation-result.js"),
    context,
  );
  context.window.qualityBarEvaluationResult.render(
    target,
    { id: "evaluation-1" },
    {
      applicability_results: [
        {
          assignment: { scope: "installation_wide" },
          evidence: {
            kind: "matched",
            matches: [
              {
                after_path: "src/current.js",
                before_path: "src/legacy.js",
                branch_ids: ["branch-1"],
                file_change_id: "file-change-1",
                predicate_ids: ["predicate-1"],
                sides: ["before", "after"],
              },
            ],
          },
          outcome: "applicable",
          review_id: "review-1",
          review_version_id: "review-version-1",
          rule: null,
        },
        {
          assignment: { scope: "repository_specific" },
          error: {
            code: "applicability_file_changes_unavailable",
            detail: "Frozen File Changes are unavailable.",
          },
          outcome: "error",
          review_id: "review-2",
          review_version_id: "review-version-2",
          rule: {
            profile: "quality-bar-restricted-cel-v1",
            source: "file_changes.exists(file, file.added)",
          },
        },
      ],
      criterion_results: [],
      file_changes: [],
      findings: [],
      outcome: "error",
      review_runs: [],
    },
    "",
  );
  assert.equal(target.textContent, "Result error");
  assert.equal(
    target.options[0].options[0].textContent,
    "Applicability review-1 review-version-1 — applicable",
  );
  assert.equal(
    target.options[0].options[1].textContent,
    "Assignment installation_wide",
  );
  assert.equal(
    target.options[0].options[2].options[0].textContent,
    "before src/legacy.js",
  );
  assert.equal(
    target.options[0].options[2].options[1].textContent,
    "after src/current.js",
  );
  assert.equal(
    target.options[1].options[0].textContent,
    "Applicability review-2 review-version-2 — error",
  );
  assert.equal(
    target.options[1].options[2].textContent,
    "Error applicability_file_changes_unavailable: Frozen File Changes are unavailable.",
  );
});
