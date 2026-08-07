import assert from "node:assert/strict";
import { test } from "node:test";

import {
  reviewRequest,
  sessionCookies,
  startApplication,
} from "./review-http-integration-support.js";

test("the authenticated Review Version resource returns the exact restricted CEL error without a write", async () => {
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
  const created =
    /** @type {{id: string, active_version: {codex_configuration: object, criteria: Array<{id: string, impact: string, instruction: string}>}}} */ (
      await createdResponse.json()
    );
  const before = {
    activeVersion: application.durableCore.get(
      "SELECT active_version_id FROM reviews WHERE id = ?",
      created.id,
    ),
    versions: application.durableCore.all(
      "SELECT id, applicability_rule FROM review_versions WHERE review_id = ?",
      created.id,
    ),
  };

  const response = await request(`/api/v1/reviews/${created.id}/versions`, {
    body: JSON.stringify({
      applicability_rule:
        'file_changes.exists(file, file.after_content.matches("(?=unsafe)"))',
      codex_configuration: created.active_version.codex_configuration,
      criteria: created.active_version.criteria.map(
        ({ id, impact, instruction }) => ({ id, impact, instruction }),
      ),
    }),
    headers,
    method: "POST",
  });

  assert.equal(response.status, 422);
  const failure =
    /** @type {{error: {code: string, message: string, request_id: string}}} */ (
      await response.json()
    );
  assert.equal(failure.error.code, "review_applicability_rule_re2_invalid");
  assert.equal(
    failure.error.message,
    "Applicability Rule contains an invalid RE2 content pattern",
  );
  assert.match(failure.error.request_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    {
      activeVersion: application.durableCore.get(
        "SELECT active_version_id FROM reviews WHERE id = ?",
        created.id,
      ),
      versions: application.durableCore.all(
        "SELECT id, applicability_rule FROM review_versions WHERE review_id = ?",
        created.id,
      ),
    },
    before,
  );
});
