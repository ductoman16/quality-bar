import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalOpenApiDocument } from "../src/canonical-api.js";

test("Evaluation related reads publish complete canonical resource schemas", () => {
  const document = canonicalOpenApiDocument();
  const paths = document.paths;
  assert.equal(
    paths["/api/v1/evaluations/{evaluation_id}/review-runs/{review_run_id}"].get
      .responses[200].content["application/json"].schema.$ref,
    "#/components/schemas/ReviewRun",
  );
  assert.equal(
    paths["/api/v1/evaluations/{evaluation_id}/findings/{finding_id}"].get
      .responses[200].content["application/json"].schema.$ref,
    "#/components/schemas/Finding",
  );
  assert.deepEqual(
    document.components.schemas.CancelledReviewRun.properties.error.properties
      .code.enum,
    ["cancelled_by_operator", "cancelled_by_supersession"],
  );
  assert.equal(
    document.components.schemas.Evaluation.properties.feedback.$ref,
    "#/components/schemas/GitHubEvaluationFeedback",
  );
  assert.deepEqual(
    document.components.schemas.GitHubFindingFeedbackPublication.properties
      .publication_status.enum,
    ["aggregate_only", "waiting", "succeeded", "unavailable"],
  );
});
