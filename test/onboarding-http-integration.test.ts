import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.ts";
import { reviewRequest } from "./review-http-integration-support.ts";

test("an onboarding token can mutate only its bound Repository and revoke itself", async () => {
  const { application, request } = await startApplication();
  const operatorHeaders = await authenticatedOperatorHeaders(request);
  const targetUrl = "https://example.com/target.git";
  const tokenResponse = await request("/api/v1/onboarding-tokens", {
    body: JSON.stringify({ repository_url: targetUrl }),
    headers: operatorHeaders,
    method: "POST",
  });
  assert.equal(tokenResponse.status, 201);
  const token = ((await tokenResponse.json()) as { token: string }).token;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "target",
    targetUrl,
    1,
    1,
  );
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "other",
    "https://example.com/other.git",
    1,
    1,
  );
  const createReview = async (name: string, repositoryId: string) => {
    const response = await request("/api/v1/reviews", {
      body: JSON.stringify(
        reviewRequest({
          assignment: {
            repository_ids: [repositoryId],
            scope: "repository_set",
          },
          name,
        }),
      ),
      headers: operatorHeaders,
      method: "POST",
    });
    assert.equal(response.status, 201);
    return (await response.json()) as { id: string };
  };
  const selected = await createReview("Selected", "other");
  const untouched = await createReview("Untouched", "other");

  const repositories = await request("/api/v1/repositories", { headers });
  assert.equal(repositories.status, 200);
  const repositoryCollection = (await repositories.json()) as {
    items: Array<{ id: string }>;
    next_cursor: string | null;
  };
  assert.deepEqual(Object.keys(repositoryCollection).sort(), [
    "items",
    "next_cursor",
  ]);
  assert.deepEqual(
    repositoryCollection.items.map(({ id }) => id),
    ["target"],
  );
  assert.equal(repositoryCollection.next_cursor, null);

  const selection = await request(
    "/api/v1/repositories/target/review-selection",
    {
      body: JSON.stringify({ review_ids: [selected.id] }),
      headers,
      method: "PUT",
    },
  );
  assert.equal(selection.status, 200);
  assert.deepEqual(await selection.json(), {
    added_review_ids: [selected.id],
    removed_review_ids: [],
  });
  assert.deepEqual(
    application.durableCore
      .all(
        "SELECT repository_id FROM review_assignment_repositories WHERE review_id = ? ORDER BY repository_id",
        selected.id,
      )
      .map((row) => row?.repository_id),
    ["other", "target"],
  );
  assert.deepEqual(
    application.durableCore
      .all(
        "SELECT repository_id FROM review_assignment_repositories WHERE review_id = ? ORDER BY repository_id",
        untouched.id,
      )
      .map((row) => row?.repository_id),
    ["other"],
  );

  const outsideScope = await request(
    "/api/v1/repositories/other/review-selection",
    {
      body: JSON.stringify({ review_ids: [] }),
      headers,
      method: "PUT",
    },
  );
  assert.equal(outsideScope.status, 404);
  assert.equal(await responseErrorCode(outsideScope), "repository_not_found");

  const created = await request("/api/v1/repositories/target/reviews", {
    body: JSON.stringify({
      applicability_rule: null,
      codex_configuration: reviewRequest().codex_configuration,
      criteria: reviewRequest().criteria,
      description: "Repository-specific checks.",
      name: "Target only",
    }),
    headers,
    method: "POST",
  });
  assert.equal(created.status, 201);
  assert.deepEqual(
    ((await created.json()) as { assignment: unknown }).assignment,
    { repository_ids: ["target"], scope: "repository_set" },
  );

  const forbidden = await request("/api/v1/system", { headers });
  assert.equal(forbidden.status, 403);
  assert.equal(
    await responseErrorCode(forbidden),
    "onboarding_scope_forbidden",
  );

  const malformedRevocation = await request.invalidRequest(
    "/api/v1/onboarding-token/revoke",
    {
      body: JSON.stringify({ ignored: true }),
      headers,
      method: "POST",
    },
  );
  assert.equal(malformedRevocation.status, 400);
  assert.equal(
    await responseErrorCode(malformedRevocation),
    "request_malformed",
  );

  const revoked = await request("/api/v1/onboarding-token/revoke", {
    body: "{}",
    headers,
    method: "POST",
  });
  assert.equal(revoked.status, 204);
  const afterRevocation = await request("/api/v1/repositories", { headers });
  assert.equal(afterRevocation.status, 401);
});
