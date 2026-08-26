import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  reviewRequest,
  startApplication,
} from "./review-http-integration-support.ts";

test("a sole implementer bearer cannot create a Review", async () => {
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
  assert.equal(created.status, 403);
  assert.equal(await responseErrorCode(created), "authorization_forbidden");
  assert.equal(
    application.durableCore.get("SELECT count(*) AS count FROM reviews")?.count,
    0,
  );
});

test("a sole implementer bearer cannot read or edit Review authoring resources", async () => {
  const { application, request } = await startApplication();
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const machineHeaders = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const operatorHeaders = await authenticatedOperatorHeaders(request);
  const firstResponse = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest({ name: "First Review" })),
    headers: operatorHeaders,
    method: "POST",
  });
  const first = (await firstResponse.json()) as {
    id: string;
    active_version: { id: string };
  };
  const listed = await request("/api/v1/reviews", {
    headers: machineHeaders,
  });
  assert.equal(listed.status, 403);
  assert.equal(await responseErrorCode(listed), "authorization_forbidden");

  const forbidden = await request(`/api/v1/reviews/${first.id}/metadata`, {
    body: JSON.stringify({
      description: "A forbidden edit.",
      name: "Forbidden Review",
    }),
    headers: machineHeaders,
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
      headers: machineHeaders,
      method: "POST",
    },
  );
  assert.equal(forbiddenVersion.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenVersion),
    "authorization_forbidden",
  );
  const forbiddenReactivation = await request(
    `/api/v1/reviews/${first.id}/active-version`,
    {
      body: JSON.stringify({
        review_version_id: first.active_version.id,
      }),
      headers: machineHeaders,
      method: "PATCH",
    },
  );
  assert.equal(forbiddenReactivation.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenReactivation),
    "authorization_forbidden",
  );
  const forbiddenArchival = await request(
    `/api/v1/reviews/${first.id}/archival`,
    {
      body: JSON.stringify({ archived: true }),
      headers: machineHeaders,
      method: "PATCH",
    },
  );
  assert.equal(forbiddenArchival.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenArchival),
    "authorization_forbidden",
  );
  const forbiddenAssignment = await request(
    `/api/v1/reviews/${first.id}/assignment`,
    {
      body: JSON.stringify({ scope: "installation_wide" }),
      headers: machineHeaders,
      method: "PATCH",
    },
  );
  assert.equal(forbiddenAssignment.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenAssignment),
    "authorization_forbidden",
  );
  const forbiddenDeletion = await request(`/api/v1/reviews/${first.id}`, {
    body: "{}",
    headers: machineHeaders,
    method: "DELETE",
  });
  assert.equal(forbiddenDeletion.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenDeletion),
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
