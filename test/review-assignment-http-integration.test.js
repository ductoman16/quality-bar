import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  reviewRequest,
  startApplication,
} from "./review-http-integration-support.js";

test("the authenticated Review Assignment resource changes one exact scope without partial state", async () => {
  const { application, request } = await startApplication();
  const headers = await authenticatedOperatorHeaders(request);
  for (const [id, createdAt] of [
    ["repository-1", 1],
    ["repository-2", 2],
  ]) {
    application.durableCore.run(
      "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
      id,
      `https://example.com/${id}.git`,
      createdAt,
      createdAt,
    );
  }
  const createdResponse = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest()),
    headers,
    method: "POST",
  });
  const created =
    /** @type {{id: string, assignment: object, active_version: object, versions: object[]}} */ (
      await createdResponse.json()
    );

  const changedResponse = await request(
    `/api/v1/reviews/${created.id}/assignment`,
    {
      body: JSON.stringify({
        repository_ids: ["repository-2", "repository-1"],
        scope: "repository_set",
      }),
      headers,
      method: "PATCH",
    },
  );

  assert.equal(changedResponse.status, 200);
  const changed = /** @type {{changed: boolean, review: typeof created}} */ (
    await changedResponse.json()
  );
  assert.equal(changed.changed, true);
  assert.deepEqual(changed.review.assignment, {
    repository_ids: ["repository-1", "repository-2"],
    scope: "repository_set",
  });
  assert.deepEqual(changed.review.active_version, created.active_version);
  assert.deepEqual(changed.review.versions, created.versions);

  const beforeFailure = {
    assignment: application.durableCore.all(
      "SELECT * FROM review_assignments WHERE review_id = ?",
      created.id,
    ),
    repositories: application.durableCore.all(
      "SELECT * FROM review_assignment_repositories WHERE review_id = ? ORDER BY repository_id",
      created.id,
    ),
  };
  const missing = await request(`/api/v1/reviews/${created.id}/assignment`, {
    body: JSON.stringify({
      repository_ids: ["repository-missing"],
      scope: "repository_set",
    }),
    headers,
    method: "PATCH",
  });
  assert.equal(missing.status, 404);
  assert.equal(
    await responseErrorCode(missing),
    "review_assignment_repository_not_found",
  );
  assert.deepEqual(
    {
      assignment: application.durableCore.all(
        "SELECT * FROM review_assignments WHERE review_id = ?",
        created.id,
      ),
      repositories: application.durableCore.all(
        "SELECT * FROM review_assignment_repositories WHERE review_id = ? ORDER BY repository_id",
        created.id,
      ),
    },
    beforeFailure,
  );

  const malformed = await request.invalidRequest(
    `/api/v1/reviews/${created.id}/assignment`,
    {
      body: JSON.stringify({
        repository_ids: [],
        scope: "repository_set",
      }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(malformed.status, 422);
  assert.equal(
    await responseErrorCode(malformed),
    "review_assignment_repository_set_empty",
  );

  const archived = await request(`/api/v1/reviews/${created.id}/archival`, {
    body: JSON.stringify({ archived: true }),
    headers,
    method: "PATCH",
  });
  assert.equal(archived.status, 200);
  const archivedChange = await request(
    `/api/v1/reviews/${created.id}/assignment`,
    {
      body: JSON.stringify({ scope: "installation_wide" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(archivedChange.status, 409);
  assert.equal(await responseErrorCode(archivedChange), "review_archived");
});
