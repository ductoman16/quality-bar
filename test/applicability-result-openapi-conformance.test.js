import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalOpenApiDocument } from "../src/canonical-api.js";
import { createHttpConformanceAssertion } from "../scripts/openapi-conformance.mjs";
import { TRIGGERED_EVALUATION_RESULT } from "./openapi-triggered-evaluation-result.js";

test("runtime conformance rejects contradictory Applicability outcomes and evidence", async () => {
  const assertion = await createHttpConformanceAssertion(
    canonicalOpenApiDocument(),
  );
  const identity = {
    assignment: { scope: "installation_wide" },
    review_id: "review-applicability",
    review_version_id: "review-version-applicability",
    rule: {
      profile: "quality-bar-restricted-cel-v1",
      source: "false",
    },
  };
  for (const applicabilityResult of [
    {
      ...identity,
      evidence: {
        branch_ids: [],
        kind: "failed_branches",
        predicate_ids: [],
      },
      outcome: "applicable",
    },
    {
      ...identity,
      evidence: {
        kind: "matched",
        matches: [
          {
            after_path: "src/file.js",
            before_path: null,
            branch_ids: ["branch-1"],
            file_change_id: "file-change-1",
            predicate_ids: ["predicate-1"],
            sides: ["change"],
          },
        ],
      },
      outcome: "not_applicable",
    },
  ]) {
    const result = /** @type {any} */ (
      structuredClone(TRIGGERED_EVALUATION_RESULT)
    );
    result.applicability_results = [applicabilityResult];
    await assert.rejects(
      () =>
        assertion.assertExchange({
          request: {
            method: "GET",
            url: "http://127.0.0.1/api/v1/evaluations/evaluation-1/result",
          },
          response: Response.json(result),
        }),
      /openapi_success_document_invalid.*applicability_results/,
    );
  }
});
