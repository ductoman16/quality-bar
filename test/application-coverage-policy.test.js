import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  APPLICATION_COVERAGE_BOUNDARY,
  APPLICATION_COVERAGE_TEST_PATHS,
  executeServedBrowserAsset,
} from "../scripts/application-coverage-policy.mjs";
import {
  maintainedApplicationPaths,
  validateCoverageSummary,
} from "../scripts/application-coverage-report.mjs";
import { BROWSER_ASSET_SOURCE_PATHS } from "../src/browser-assets.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("application coverage has one positive maintained-code boundary", () => {
  assert.deepEqual(APPLICATION_COVERAGE_BOUNDARY, {
    include: ["src/**/*.js"],
    excludedRoots: ["artifacts", "evidence", "fixtures", "scripts", "test"],
    servedBrowserAssets: [
      "src/browser/login.js",
      "src/browser/operator.js",
      "src/browser/evaluation-result.js",
      "src/browser/evaluation.js",
      "src/browser/system-attention.js",
      "src/browser/storage-reserve.js",
      "src/browser/waiver-adjudicator-configuration.js",
      "src/browser/github-connection-contract.js",
      "src/browser/github-connection-lifecycle-confirmation.js",
      "src/browser/github-connection-submission.js",
      "src/browser/github-connection.js",
      "src/browser/forgejo-connection-contract.js",
      "src/browser/forgejo-connection-lifecycle-confirmation.js",
      "src/browser/forgejo-connection.js",
      "src/browser/repository.js",
      "src/browser/repository-delete.js",
      "src/browser/repository-guidance.js",
      "src/browser/review-metadata.js",
      "src/browser/review-create.js",
      "src/browser/review-criteria.js",
      "src/browser/review-version-contract.js",
      "src/browser/review-version.js",
      "src/browser/review-reactivation.js",
      "src/browser/review-archival.js",
      "src/browser/review-assignment.js",
    ],
  });
  assert.deepEqual(
    APPLICATION_COVERAGE_BOUNDARY.servedBrowserAssets,
    BROWSER_ASSET_SOURCE_PATHS,
  );
});

test("coverage executes the deterministic application proof pyramid without smokes", () => {
  assert.ok(APPLICATION_COVERAGE_TEST_PATHS.length > 0);
  assert.ok(
    APPLICATION_COVERAGE_TEST_PATHS.includes(
      "test/browser-assets-browser-component.test.js",
    ),
  );
  assert.ok(
    APPLICATION_COVERAGE_TEST_PATHS.includes(
      "test/review-metadata-browser-component.test.js",
    ),
  );
  assert.ok(
    APPLICATION_COVERAGE_TEST_PATHS.includes(
      "test/review-create-browser-component.test.js",
    ),
  );
  assert.ok(
    APPLICATION_COVERAGE_TEST_PATHS.includes(
      "test/review-version-browser-component.test.js",
    ),
  );
  assert.ok(
    APPLICATION_COVERAGE_TEST_PATHS.includes(
      "test/review-criterion-retirement-browser-component.test.js",
    ),
  );
  assert.ok(
    APPLICATION_COVERAGE_TEST_PATHS.includes(
      "test/review-criterion-retirement-http-integration.test.js",
    ),
  );
  for (const path of [
    "test/applicability-rule.test.js",
    "test/repository-collection.test.js",
    "test/review-applicability-rule-browser-component.test.js",
    "test/review-assignment-browser-component.test.js",
    "test/repository-guidance-browser-component.test.js",
    "test/review-applicability-rule-sqlite-integration.test.js",
    "test/review-assignment-sqlite-integration.test.js",
    "test/repository-guidance-sqlite-integration.test.js",
    "test/review-applicability-rule-http-integration.test.js",
    "test/review-assignment-http-integration.test.js",
    "test/repository-guidance-http-integration.test.js",
    "test/review-archival.test.js",
    "test/review-selection.test.js",
    "test/review-archival-browser-component.test.js",
    "test/review-archival-sqlite-integration.test.js",
    "test/review-archival-http-integration.test.js",
  ]) {
    assert.ok(APPLICATION_COVERAGE_TEST_PATHS.includes(path));
  }
  assert.ok(
    APPLICATION_COVERAGE_TEST_PATHS.includes(
      "test/repository-guidance.test.js",
    ),
  );
  assert.ok(
    APPLICATION_COVERAGE_TEST_PATHS.includes(
      "test/review-http-integration.test.js",
    ),
  );
  assert.ok(
    APPLICATION_COVERAGE_TEST_PATHS.includes(
      "test/repository-lifecycle-http-integration.test.js",
    ),
  );
  assert.ok(
    APPLICATION_COVERAGE_TEST_PATHS.includes(
      "test/repository-http-integration.test.js",
    ),
  );
  assert.ok(
    !APPLICATION_COVERAGE_TEST_PATHS.some(
      (path) => path.includes("smoke") || path.includes("package"),
    ),
  );
});

test("served browser bytes execute under their maintained source identity", () => {
  for (const sourcePath of BROWSER_ASSET_SOURCE_PATHS) {
    const source = readFileSync(resolve(repositoryRoot, sourcePath), "utf8");
    let stack = "";
    try {
      executeServedBrowserAsset(
        repositoryRoot,
        sourcePath,
        `${source}\nthrow new Error("source identity");\n`,
        {},
      );
      assert.fail("served browser asset must throw");
    } catch (error) {
      stack =
        typeof error === "object" &&
        error !== null &&
        "stack" in error &&
        typeof error.stack === "string"
          ? error.stack
          : String(error);
    }
    assert.match(stack, new RegExp(sourcePath.replaceAll(".", "\\.")));
  }
});

test("served browser execution rejects an asset outside the reviewed boundary", () => {
  assert.throws(
    () =>
      executeServedBrowserAsset(
        repositoryRoot,
        "test/copied-browser-implementation.js",
        "throw new Error('must not execute')",
        {},
      ),
    /application_coverage_unreviewed_browser_asset/,
  );
});

test("the coverage helper executes the supplied served bytes", () => {
  const context = { answer: 0 };
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/login.js",
    "answer = 42;",
    context,
  );
  assert.equal(context.answer, 42);
});

test("coverage summary requires every maintained application file and exact assets", () => {
  /** @type {Record<string, unknown>} */
  const summary = {
    total: {
      lines: { pct: 86.01 },
      branches: { pct: 83.26 },
      functions: { pct: 88.71 },
    },
  };
  for (const path of maintainedApplicationPaths(repositoryRoot)) {
    summary[resolve(repositoryRoot, path)] = {};
  }
  const result = validateCoverageSummary(repositoryRoot, summary, {
    lines: "86.01",
    branches: "83.26",
    functions: "88.71",
  });
  assert.equal(
    result.fileCount,
    maintainedApplicationPaths(repositoryRoot).length,
  );
  assert.deepEqual(result.measured, {
    lines: "86.01",
    branches: "83.26",
    functions: "88.71",
  });

  delete summary[resolve(repositoryRoot, "src/browser/login.js")];
  assert.throws(
    () =>
      validateCoverageSummary(repositoryRoot, summary, {
        lines: "86.01",
        branches: "83.26",
        functions: "88.71",
      }),
    /application_coverage_file_boundary_mismatch/,
  );
});

test("coverage summary hard-fails below any committed component", () => {
  const summary = {
    total: {
      lines: { pct: 86 },
      branches: { pct: 83.26 },
      functions: { pct: 88.71 },
    },
  };
  assert.throws(
    () =>
      validateCoverageSummary(repositoryRoot, summary, {
        lines: "86.01",
        branches: "83.26",
        functions: "88.71",
      }),
    /application_coverage_below_threshold: lines measured 86.00 required 86.01/,
  );
});
