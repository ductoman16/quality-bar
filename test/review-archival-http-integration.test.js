import assert from "node:assert/strict";
import { test } from "node:test";

import {
  responseErrorCode,
  reviewRequest,
  sessionCookies,
  startApplication,
} from "./review-http-integration-support.js";

test("the authenticated Review archival resource excludes and restores one complete lineage", async () => {
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
    /** @type {{id: string, active_version: {id: string, codex_configuration: object, criteria: Array<{id: string, impact: string, instruction: string}>}, archived: boolean, versions: unknown[]}} */ (
      await createdResponse.json()
    );
  const preservedFacts = {
    assignment: application.durableCore.all(
      "SELECT * FROM review_assignments WHERE review_id = ?",
      created.id,
    ),
    versions: application.durableCore.all(
      "SELECT * FROM review_versions WHERE review_id = ?",
      created.id,
    ),
  };

  const archivedResponse = await request(
    `/api/v1/reviews/${created.id}/archival`,
    {
      body: JSON.stringify({ archived: true }),
      headers,
      method: "PATCH",
    },
  );

  assert.equal(archivedResponse.status, 200);
  const archived = /** @type {{changed: boolean, review: typeof created}} */ (
    await archivedResponse.json()
  );
  assert.equal(archived.changed, true);
  assert.equal(archived.review.archived, true);
  assert.equal(archived.review.active_version.id, created.active_version.id);
  assert.deepEqual(archived.review.versions, created.versions);
  const active = await request("/api/v1/reviews", {
    headers: { cookie: session },
  });
  assert.deepEqual(await active.json(), { reviews: [] });
  const archivedCollection = await request("/api/v1/reviews?state=archived", {
    headers: { cookie: session },
  });
  assert.deepEqual(await archivedCollection.json(), {
    reviews: [archived.review],
  });
  assert.deepEqual(
    {
      assignment: application.durableCore.all(
        "SELECT * FROM review_assignments WHERE review_id = ?",
        created.id,
      ),
      versions: application.durableCore.all(
        "SELECT * FROM review_versions WHERE review_id = ?",
        created.id,
      ),
    },
    preservedFacts,
  );

  const archivedSave = await request(`/api/v1/reviews/${created.id}/versions`, {
    body: JSON.stringify({
      applicability_rule: null,
      codex_configuration: created.active_version.codex_configuration,
      criteria: created.active_version.criteria.map(
        ({ id, impact, instruction }) => ({ id, impact, instruction }),
      ),
    }),
    headers,
    method: "POST",
  });
  assert.equal(archivedSave.status, 409);
  assert.equal(await responseErrorCode(archivedSave), "review_archived");

  const restoredResponse = await request(
    `/api/v1/reviews/${created.id}/archival`,
    {
      body: JSON.stringify({ archived: false }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(restoredResponse.status, 200);
  const restored = /** @type {{changed: boolean, review: typeof created}} */ (
    await restoredResponse.json()
  );
  assert.equal(restored.changed, true);
  assert.equal(restored.review.archived, false);
  assert.equal(restored.review.active_version.id, created.active_version.id);

  const malformed = await request.invalidRequest(
    `/api/v1/reviews/${created.id}/archival`,
    {
      body: JSON.stringify({ archived: "false" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(malformed.status, 422);
  assert.equal(
    await responseErrorCode(malformed),
    "review_archival_request_malformed",
  );
  const invalidFilter = await request("/api/v1/reviews?state=all", {
    headers: { cookie: session },
  });
  assert.equal(invalidFilter.status, 400);
  assert.equal(
    await responseErrorCode(invalidFilter),
    "review_list_state_invalid",
  );
});

test("an unexpected Review archival failure surfaces its exact owning error", async () => {
  const failure = new Error("exact Review archival failure");
  const { request } = await startApplication({
    createReviews() {
      return {
        create() {
          throw failure;
        },
        list() {
          throw failure;
        },
        reactivateVersion() {
          throw failure;
        },
        saveVersion() {
          throw failure;
        },
        setArchived() {
          throw failure;
        },
        selectForNewEvaluation() {
          throw failure;
        },
        updateMetadata() {
          throw failure;
        },
      };
    },
  });
  const login = await request("/api/v1/session/login", {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { csrf, session } = sessionCookies(login);
  const response = await request("/api/v1/reviews/review-1/archival", {
    body: JSON.stringify({ archived: true }),
    headers: {
      "content-type": "application/json",
      cookie: `${session}; quality_bar_csrf=${csrf}`,
      origin: "http://127.0.0.1:3000",
      "x-quality-bar-csrf": csrf,
    },
    method: "PATCH",
  });

  assert.equal(response.status, 500);
  const body = /** @type {{error: {code: string, message: string}}} */ (
    await response.json()
  );
  assert.equal(body.error.code, "review_archival_failed");
  assert.equal(body.error.message, "exact Review archival failure");
});
