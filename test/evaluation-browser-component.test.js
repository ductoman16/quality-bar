import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import {
  FAILED_REVIEW_RUN_EVALUATION_RESULT,
  TRIGGERED_EVALUATION_RESULT,
} from "./openapi-triggered-evaluation-result.js";
import {
  assertEvaluationPage,
  evaluation,
  evaluationElements,
  reviewRunDiagnosticsResponse,
} from "./evaluation-browser-component-support.js";
import { browserElement } from "./repository-browser-component-support.js";

test("Evaluations renders no partial data before the complete first-valid Result", async () => {
  const page = operatorPage({ view: "evaluations" });
  assertEvaluationPage(page);
  assert.equal(page, operatorPage({ view: "evaluations" }));

  const controls = evaluationElements();
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
                evaluation({
                  base_selector: { type: "branch", value: "failure" },
                  id: "evaluation-result-failure",
                  provenance: "automatic",
                  pull_request: { number: 17 },
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
                evaluation({
                  effective_outcome: "error",
                  id: "evaluation-run-failed",
                }),
              ],
              next_cursor: "cursor-2",
            };
          },
        };
      }
      if (path === "/api/v1/evaluations/evaluation-triggered") {
        return {
          ok: true,
          async json() {
            return evaluation({
              effective_outcome: "error",
              id: "evaluation-triggered",
            });
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
                  execution_status: "failed",
                  id: "evaluation-older",
                }),
              ],
              next_cursor: null,
            };
          },
        };
      }
      if (path === "/api/v1/evaluations/evaluation-triggered/result") {
        return {
          ok: true,
          async json() {
            return {
              ...TRIGGERED_EVALUATION_RESULT,
              findings: TRIGGERED_EVALUATION_RESULT.findings.map((finding) => ({
                ...finding,
                impact: "advisory",
              })),
            };
          },
        };
      }
      if (
        path === "/api/v1/evaluations/evaluation-triggered/waiver-adjudications"
      ) {
        return {
          ok: true,
          async json() {
            return options?.method === "POST"
              ? {
                  adjudication: {
                    execution_status: "queued",
                    id: "waiver-adjudication-browser",
                  },
                }
              : { items: [] };
          },
        };
      }
      if (path === "/api/v1/evaluations/evaluation-run-failed/result") {
        return {
          ok: true,
          async json() {
            return FAILED_REVIEW_RUN_EVALUATION_RESULT;
          },
        };
      }
      if (path === "/api/v1/evaluations/evaluation-result-failure/result") {
        throw new Error("simulated Result transport failure");
      }
      if (path.endsWith("/waiver-adjudications")) {
        return {
          ok: true,
          async json() {
            return { items: [] };
          },
        };
      }
      if (path.endsWith("/diagnostics")) {
        return reviewRunDiagnosticsResponse(path);
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
      location: {
        search:
          "?view=evaluations&evaluation_id=evaluation-triggered&file_change_id=file-change-1&side=head&start_line=2&end_line=3",
      },
      qualityBarOperator: {
        csrfToken: () => "browser-csrf-owned-secret",
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
  for (const [sourcePath, route] of [
    ["src/browser/waiver-batch.js", "/assets/waiver-batch.js"],
    ["src/browser/evaluation-result.js", "/assets/evaluation-result.js"],
    ["src/browser/evaluation-feedback.js", "/assets/evaluation-feedback.js"],
    [
      "src/browser/evaluation-active-controls.js",
      "/assets/evaluation-active-controls.js",
    ],
    ["src/browser/evaluation.js", "/assets/evaluation.js"],
  ]) {
    executeServedBrowserAsset(
      resolve("."),
      sourcePath,
      readBrowserAsset(route),
      context,
    );
  }
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  assert.equal(controls.get("evaluation-loading").hidden, true);
  assert.equal(controls.get("evaluation-empty").hidden, true);
  assert.match(
    controls.get("evaluation-recent").options[0].textContent,
    /automatic pull request #17 branch failure/,
  );
  assert.equal(
    controls.get("evaluation-recent").options[0].options[0].textContent,
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
  const failedRunResult = controls.get("evaluation-attention").options[1]
    .options[0];
  assert.equal(failedRunResult.textContent, "Result error");
  assert.equal(
    failedRunResult.options[0].options[0].textContent,
    "Review review-1 review-version-1 — failed",
  );
  assert.equal(
    failedRunResult.options[0].options[1].textContent,
    "Error configuration_unavailable: Network-disabled Codex launch could not be constructed.",
  );
  assert.equal(
    failedRunResult.options[1].options[0].textContent,
    "Criterion criterion-completed-sibling — clear — Review review-completed review-version-completed",
  );
  assert.match(
    controls.get("evaluation-attention").options[2].textContent,
    /completed — error/,
  );
  const resultDetails = controls.get("evaluation-attention").options[2]
    .options[0];
  assert.equal(resultDetails.textContent, "Result error");
  const criterionDetails = resultDetails.options[0];
  assert.equal(
    criterionDetails.options[0].textContent,
    "Criterion criterion-1 — triggered — Review review-1 review-version-1",
  );
  const findingDetails = criterionDetails.options[1];
  assert.equal(criterionDetails.open, true);
  assert.equal(findingDetails.open, true);
  assert.equal(
    findingDetails.options[0].textContent,
    "Finding finding-1 — advisory",
  );
  assert.equal(
    findingDetails.options[1].textContent,
    "Evidence: The changed branch returns stale state.",
  );
  assert.equal(
    findingDetails.options[2].textContent,
    "Remediation: Return the newly computed state.",
  );
  assert.deepEqual(
    {
      href: findingDetails.options[3].href,
      textContent: findingDetails.options[3].textContent,
    },
    {
      href: "/?view=evaluations&evaluation_id=evaluation-triggered&file_change_id=file-change-1&side=head&start_line=2&end_line=3",
      textContent: "head src/current.js:2-3",
    },
  );
  const frozenDiff = findingDetails.options[5];
  assert.equal(frozenDiff.open, true);
  assert.equal(
    frozenDiff.options[0].textContent,
    "Frozen diff — head src/current.js:2-3",
  );
  assert.match(frozenDiff.options[1].textContent, /-old state\n\+new state/);
  const rationale = findingDetails.options[4];
  rationale.value = "This generated state is required for this deployment.";
  const waiverForm = resultDetails.options[3];
  await waiverForm.listener("submit")({ preventDefault() {} });
  const waiverSubmission = requests.find(
    ({ options, path }) =>
      path ===
        "/api/v1/evaluations/evaluation-triggered/waiver-adjudications" &&
      options?.method === "POST",
  );
  assert.ok(waiverSubmission);
  assert.deepEqual(JSON.parse(waiverSubmission.options.body), {
    requests: [
      {
        finding_id: "finding-1",
        rationale: "This generated state is required for this deployment.",
      },
    ],
  });
  assert.equal(
    waiverForm.options[1].textContent,
    "Waiver Adjudication waiver-adjudication-browser queued.",
  );
  assert.equal(
    resultDetails.options[1].options[0].textContent,
    "Criterion criterion-2 — not applicable — Review review-1 review-version-1",
  );
  assert.equal(
    resultDetails.options[2].options[0].textContent,
    "Criterion criterion-3 — error — Review review-1 review-version-1",
  );
  assert.equal(
    resultDetails.options[2].options[1].textContent,
    "Error required_evidence_unavailable: The required generated file is absent from the head.",
  );
  assert.match(
    controls.get("evaluation-attention").options[0].textContent,
    /failed — error/,
  );
  assert.equal(controls.get("evaluation-more").hidden, false);
  await controls.get("evaluation-more").listener("click")();
  assert.equal(controls.get("evaluation-more").hidden, true);
  assert.match(
    controls.get("evaluation-attention").options[3].textContent,
    /failed — error/,
  );
  assert.ok(
    requests.some(({ path }) => path === "/api/v1/evaluations?cursor=cursor-2"),
  );
  assert.ok(
    requests.some(
      ({ path }) => path === "/api/v1/evaluations/evaluation-triggered",
    ),
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
        "x-quality-bar-csrf": "browser-csrf-owned-secret",
      },
      method: "POST",
    },
    path: "/api/v1/repositories/repository-1/evaluations",
  });
  assert.equal(
    controls.get("evaluation-create-status").textContent,
    "Evaluation evaluation-created completed.",
  );
  assert.doesNotMatch(
    JSON.stringify([...controls.values()]),
    /browser-csrf-owned-secret|authorization|cookie/i,
  );
});
