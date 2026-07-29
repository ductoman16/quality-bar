import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalOpenApiDocument } from "../src/canonical-api.js";

test("Evaluation related reads publish complete canonical resource schemas", () => {
  const paths = canonicalOpenApiDocument().paths;
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
});
