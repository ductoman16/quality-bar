import assert from "node:assert/strict";
import { test } from "node:test";

import {
  responseErrorCode,
  reviewRequest,
  startApplication,
} from "./review-http-integration-support.js";

test("a sole implementer bearer creates the same Review resource without browser CSRF", async () => {
  const { application, request } = await startApplication();
  const token = application.implementerTokens.create(
    "a correct operator password",
  );

  const created = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest({ name: "Machine HTTP boundaries" })),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  assert.equal(created.status, 201);
  const createdReview = /** @type {{name: string}} */ (await created.json());
  assert.equal(createdReview.name, "Machine HTTP boundaries");
});

test("a sole implementer bearer cannot read or edit Review authoring resources", async () => {
  const { application, request } = await startApplication();
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const firstResponse = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest({ name: "First Review" })),
    headers,
    method: "POST",
  });
  const first = /** @type {{id: string}} */ (await firstResponse.json());
  const listed = await request("/api/v1/reviews", { headers });
  assert.equal(listed.status, 403);
  assert.equal(await responseErrorCode(listed), "authorization_forbidden");

  const forbidden = await request(`/api/v1/reviews/${first.id}/metadata`, {
    body: JSON.stringify({
      description: "A forbidden edit.",
      name: "Forbidden Review",
    }),
    headers,
    method: "PATCH",
  });
  assert.equal(forbidden.status, 403);
  assert.equal(await responseErrorCode(forbidden), "authorization_forbidden");

  const forbiddenVersion = await request(
    `/api/v1/reviews/${first.id}/versions`,
    {
      body: JSON.stringify({
        applicability_rule: null,
        codex_configuration: {
          model: "gpt-5.6-terra",
          reasoning_effort: "high",
          service_tier: "standard",
        },
        criteria: [
          {
            id: `${first.id}-criterion`,
            impact: "blocking",
            instruction: "A forbidden executable change.",
          },
        ],
      }),
      headers,
      method: "POST",
    },
  );
  assert.equal(forbiddenVersion.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenVersion),
    "authorization_forbidden",
  );

  assert.deepEqual(
    application.durableCore.get(
      "SELECT name, description FROM reviews WHERE id = ?",
      first.id,
    ),
    {
      name: "First Review",
      description: "Keep authenticated mutations safe.",
    },
  );
  assert.equal(
    application.durableCore.get("SELECT count(*) AS count FROM review_versions")
      ?.count,
    1,
  );
});
