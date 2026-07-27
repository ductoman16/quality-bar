import assert from "node:assert/strict";
import { test } from "node:test";

import {
  responseErrorCode,
  reviewRequest,
  sessionCookies,
  startApplication,
} from "./review-http-integration-support.js";

test("the Review Version resource retires and replaces Criteria atomically", async () => {
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
    body: JSON.stringify(
      reviewRequest({
        criteria: [
          { impact: "advisory", instruction: "Retire this meaning." },
          { impact: "blocking", instruction: "Keep this Criterion." },
        ],
      }),
    ),
    headers,
    method: "POST",
  });
  const created =
    /** @type {{id: string, active_version: {criteria: Array<{id: string, impact: string, instruction: string}>}}} */ (
      await createdResponse.json()
    );
  const [retired, retained] = created.active_version.criteria;
  assert.ok(retired);
  assert.ok(retained);
  const snapshot = {
    applicability_rule: null,
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        id: retained.id,
        impact: retained.impact,
        instruction: retained.instruction,
      },
      {
        impact: "blocking",
        instruction: "Use the replacement meaning.",
      },
    ],
  };

  const savedResponse = await request(
    `/api/v1/reviews/${created.id}/versions`,
    { body: JSON.stringify(snapshot), headers, method: "POST" },
  );
  assert.equal(savedResponse.status, 200);
  const saved =
    /** @type {{review: {active_version: {criteria: Array<{id: string}>}}}} */ (
      await savedResponse.json()
    ).review;
  const replacement = saved.active_version.criteria[1];
  assert.ok(replacement);
  assert.notEqual(replacement.id, retired.id);
  assert.deepEqual(
    application.durableCore.all(
      `SELECT
         review_versions.number,
         review_version_criteria.criterion_id
       FROM review_version_criteria
       JOIN review_versions
         ON review_versions.id = review_version_criteria.review_version_id
       ORDER BY review_versions.number, review_version_criteria.position`,
    ),
    [
      { number: 1, criterion_id: retired.id },
      { number: 1, criterion_id: retained.id },
      { number: 2, criterion_id: retained.id },
      { number: 2, criterion_id: replacement.id },
    ],
  );

  const rejected = await request.invalidRequest(
    `/api/v1/reviews/${created.id}/versions`,
    {
      body: JSON.stringify({ ...snapshot, criteria: [] }),
      headers,
      method: "POST",
    },
  );
  assert.equal(rejected.status, 422);
  assert.equal(await responseErrorCode(rejected), "review_criteria_invalid");
  assert.equal(
    application.durableCore.get("SELECT count(*) AS count FROM review_versions")
      ?.count,
    2,
  );
  assert.equal(
    application.durableCore.get("SELECT count(*) AS count FROM criteria")
      ?.count,
    3,
  );
});
