import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  reviewRequest,
  startApplication,
} from "./review-http-integration-support.js";
import { createUnavailableReviewService } from "../src/review/review.js";

test("the canonical Review resource deletes only a never-used lineage", async () => {
  const { application, request } = await startApplication();
  const headers = await authenticatedOperatorHeaders(request);
  const unusedResponse = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest({ name: "Never used Review" })),
    headers,
    method: "POST",
  });
  const unused = /** @type {{id: string}} */ (await unusedResponse.json());

  for (const [malformedBody, expectedCode] of [
    ["null", "request_malformed"],
    ["[]", "request_malformed"],
    ['{"confirmed":true}', "review_deletion_request_malformed"],
  ]) {
    const malformed = await request.invalidRequest(
      `/api/v1/reviews/${unused.id}`,
      {
        body: malformedBody,
        headers,
        method: "DELETE",
      },
    );
    assert.equal(malformed.status, 400);
    assert.equal(await responseErrorCode(malformed), expectedCode);
  }
  const deleted = await request(`/api/v1/reviews/${unused.id}`, {
    body: "{}",
    headers,
    method: "DELETE",
  });
  assert.equal(deleted.status, 200);
  assert.equal(await deleted.json(), null);

  const usedResponse = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest({ name: "Used Review" })),
    headers,
    method: "POST",
  });
  const used = /** @type {{id: string, active_version: {id: string}}} */ (
    await usedResponse.json()
  );
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-review-http-delete",
    "https://example.invalid/review-http-delete.git",
    1,
    1,
  );
  application.durableCore.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance, base_selector_type, base_selector_value,
       head_selector_type, head_selector_value, base_commit, head_commit,
       execution_status, created_at
     ) VALUES (?, ?, 'explicit', 'commit', ?, 'commit', ?, ?, ?, 'queued', ?)`,
    "evaluation-review-http-delete",
    "repository-review-http-delete",
    "a".repeat(40),
    "b".repeat(40),
    "a".repeat(40),
    "b".repeat(40),
    2,
  );
  application.durableCore.run(
    `INSERT INTO review_runs (
       id, evaluation_id, review_id, review_version_id,
       execution_status, created_at
     ) VALUES (?, ?, ?, ?, 'queued', ?)`,
    "review-run-http-delete",
    "evaluation-review-http-delete",
    used.id,
    used.active_version.id,
    2,
  );

  const unsupported = await request(`/api/v1/reviews/${used.id}`, {
    body: "{}",
    headers,
    method: "DELETE",
  });
  assert.equal(unsupported.status, 409);
  assert.equal(
    await responseErrorCode(unsupported),
    "review_delete_unsupported",
  );
  assert.deepEqual(
    application.durableCore.get(
      "SELECT review_id, review_version_id FROM review_runs WHERE id = ?",
      "review-run-http-delete",
    ),
    {
      review_id: used.id,
      review_version_id: used.active_version.id,
    },
  );

  const archived = await request(`/api/v1/reviews/${used.id}/archival`, {
    body: JSON.stringify({ archived: true }),
    headers,
    method: "PATCH",
  });
  assert.equal(archived.status, 200);
});

test("an unexpected Review deletion failure surfaces its exact owning error", async () => {
  const failure = new Error("exact Review deletion failure");
  const { request } = await startApplication({
    createReviews() {
      return createUnavailableReviewService(failure);
    },
  });
  const headers = await authenticatedOperatorHeaders(request);
  const response = await request("/api/v1/reviews/review-1", {
    body: "{}",
    headers,
    method: "DELETE",
  });

  assert.equal(response.status, 500);
  const body = /** @type {{error: {code: string, message: string}}} */ (
    await response.json()
  );
  assert.equal(body.error.code, "review_deletion_failed");
  assert.equal(body.error.message, "exact Review deletion failure");
});
