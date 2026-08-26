import assert from "node:assert/strict";
import { test } from "node:test";

import {
  responseErrorCode,
  reviewRequest,
  sessionCookies,
  startApplication,
} from "./review-http-integration-support.ts";

test("the authenticated active Review Version resource reactivates history without creating a version", async () => {
  const { application, request } = await startApplication();
  const login = await request("/api/v1/session/login", {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { csrf, session } = sessionCookies(login);
  const headers = {
    "content-type": "application/json",
    cookie: `${session}; quality_bar_csrf=${csrf}`,
    origin: "http://127.0.0.1:3000",
    "x-quality-bar-csrf": csrf,
  };
  const createdResponse = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest()),
    headers,
    method: "POST",
  });
  const created = (await createdResponse.json()) as {
    id: string;
    active_version: {
      id: string;
      codex_configuration: object;
      criteria: Array<{ id: string; impact: string; instruction: string }>;
    };
  };
  const savedResponse = await request(
    `/api/v1/reviews/${created.id}/versions`,
    {
      body: JSON.stringify({
        applicability_rule: "true",
        codex_configuration: created.active_version.codex_configuration,
        criteria: created.active_version.criteria.map(
          ({ id, impact, instruction }) => ({
            id,
            impact,
            instruction: instruction + " Updated.",
          }),
        ),
      }),
      headers,
      method: "POST",
    },
  );
  assert.equal(savedResponse.status, 200);

  const reactivatedResponse = await request(
    `/api/v1/reviews/${created.id}/active-version`,
    {
      body: JSON.stringify({
        review_version_id: created.active_version.id,
      }),
      headers,
      method: "PATCH",
    },
  );

  assert.equal(reactivatedResponse.status, 200);
  const reactivated = (await reactivatedResponse.json()) as {
    changed: boolean;
    review: { active_version: { id: string }; versions: Array<{ id: string }> };
  };
  assert.equal(reactivated.changed, true);
  assert.equal(reactivated.review.active_version.id, created.active_version.id);
  assert.equal(reactivated.review.versions.length, 2);
  assert.equal(
    application.durableCore.get("SELECT count(*) AS count FROM review_versions")
      ?.count,
    2,
  );

  const missingResponse = await request(
    `/api/v1/reviews/${created.id}/active-version`,
    {
      body: JSON.stringify({ review_version_id: "missing-version" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(missingResponse.status, 404);
  assert.equal(
    await responseErrorCode(missingResponse),
    "review_version_not_found",
  );

  const criterion = created.active_version.criteria[0];
  assert.ok(criterion);
  application.durableCore.run(
    "INSERT INTO review_versions (id, review_id, number, model, reasoning_effort, service_tier, applicability_rule, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    "obsolete-http-version",
    created.id,
    3,
    "obsolete-model",
    "high",
    "standard",
    null,
    1,
  );
  application.durableCore.run(
    "INSERT INTO review_version_criteria (review_version_id, criterion_id, position, instruction, impact) VALUES (?, ?, ?, ?, ?)",
    "obsolete-http-version",
    criterion.id,
    1,
    criterion.instruction,
    criterion.impact,
  );
  application.durableCore.run(
    "UPDATE review_versions SET sealed_at = ? WHERE id = ?",
    1,
    "obsolete-http-version",
  );
  const obsoleteResponse = await request(
    `/api/v1/reviews/${created.id}/active-version`,
    {
      body: JSON.stringify({ review_version_id: "obsolete-http-version" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(obsoleteResponse.status, 422);
  assert.equal(
    await responseErrorCode(obsoleteResponse),
    "codex_model_unsupported",
  );
  assert.deepEqual(
    application.durableCore.get(
      "SELECT active_version_id FROM reviews WHERE id = ?",
      created.id,
    ),
    { active_version_id: created.active_version.id },
  );
});
