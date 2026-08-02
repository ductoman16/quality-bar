import assert from "node:assert/strict";
import test from "node:test";

import { arrangeForgejoFeedback } from "./forgejo-feedback-publication-support.js";
import { arrangeGitHubFeedback } from "./github-feedback-publication-support.js";
import {
  authenticatedOperatorHeaders,
  startApplication,
} from "./http-integration-support.js";
import { addWaiverFollowupFacts } from "./system-polling-delivery-support.js";

test("the authenticated System API exposes polling and delivery facts from SQLite", async () => {
  const { application, request } = await startApplication();
  arrangeGitHubFeedback(application.durableCore);
  application.durableCore.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );

  const headers = await authenticatedOperatorHeaders(request);
  const response = await request("/api/v1/system", { headers });
  assert.equal(response.status, 200);
  const system = /** @type {any} */ (await response.json());
  assert.deepEqual(system.polling.connections[0], {
    connection_id: "connection-1",
    error: null,
    external_identity: {
      app_id: 47,
      app_slug: "quality-bar",
      installation_id: 73,
      principal_id: 91,
      principal_login: "operator",
    },
    health: "healthy",
    health_error: null,
    lifecycle: "enabled",
    next_attempt_at: null,
    next_attempt_after_correction: false,
    provider: "github",
    rate_gate_until: null,
    repositories: [
      {
        baseline_status: "pending",
        error: null,
        forge_repository_id: 101,
        health: "healthy",
        health_error: null,
        last_success_at: null,
        name: "operator/repository",
        lifecycle: "enabled",
        next_attempt_at: null,
        next_attempt_after_correction: false,
        rate_gate_until: null,
        repository_id: "repository-1",
      },
    ],
  });
  assert.ok(system.delivery.surfaces.length >= 2);
  assert.ok(
    system.delivery.surfaces.every(
      /** @param {any} surface */ (surface) =>
        surface.connection_id === "connection-1" &&
        surface.repository_id === "repository-1" &&
        surface.evaluation_id === "evaluation-1",
    ),
  );
});

test("the authenticated System API preserves waiver ownership before delivery starts", async () => {
  const { application, request } = await startApplication();
  const headers = await authenticatedOperatorHeaders(request);
  const { base, head } = arrangeForgejoFeedback(application.durableCore, {
    impact: "advisory",
  });
  application.durableCore.run(
    "INSERT INTO forgejo_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );
  addWaiverFollowupFacts(application.durableCore, base, head);

  const response = await request("/api/v1/system", { headers });
  assert.equal(response.status, 200);
  const system = /** @type {any} */ (await response.json());
  const byOwner = new Map(
    system.delivery.surfaces
      .filter(
        /** @param {any} surface */ (surface) =>
          surface.source_identity.startsWith("waiver-"),
      )
      .map(
        /** @param {any} surface */ (surface) => [surface.owner_kind, surface],
      ),
  );
  assert.deepEqual(
    {
      adjudication_id: byOwner.get("adjudication")?.adjudication_id,
      connection_id: byOwner.get("adjudication")?.connection_id,
      owner_kind: byOwner.get("adjudication")?.owner_kind,
      repository_id: byOwner.get("adjudication")?.repository_id,
      status: byOwner.get("adjudication")?.status,
      target: byOwner.get("adjudication")?.target,
    },
    {
      adjudication_id: "adjudication-1",
      connection_id: "connection-1",
      owner_kind: "adjudication",
      repository_id: "repository-1",
      status: "waiting",
      target: null,
    },
  );
  assert.deepEqual(
    {
      adjudication_id: byOwner.get("decision")?.adjudication_id,
      connection_id: byOwner.get("decision")?.connection_id,
      decision_id: byOwner.get("decision")?.decision_id,
      finding_id: byOwner.get("decision")?.finding_id,
      owner_kind: byOwner.get("decision")?.owner_kind,
      repository_id: byOwner.get("decision")?.repository_id,
      status: byOwner.get("decision")?.status,
      target: byOwner.get("decision")?.target,
    },
    {
      adjudication_id: "adjudication-1",
      connection_id: "connection-1",
      decision_id: "decision-1",
      finding_id: "finding-inline",
      owner_kind: "decision",
      repository_id: "repository-1",
      status: "waiting",
      target: null,
    },
  );
});

test("the authenticated System API rejects a waiver decision target with another Adjudication", async () => {
  const { application, request } = await startApplication();
  const headers = await authenticatedOperatorHeaders(request);
  const { base, head } = arrangeForgejoFeedback(application.durableCore, {
    impact: "advisory",
  });
  application.durableCore.run(
    "INSERT INTO forgejo_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );
  addWaiverFollowupFacts(application.durableCore, base, head);
  application.durableCore.run(
    `INSERT INTO forgejo_finding_feedback (
       finding_id, evaluation_id, publication_status,
       path, side, line, external_id, published_at
     ) VALUES ('finding-inline', 'evaluation-1', 'succeeded',
       'src/example.js', 'RIGHT', 2, 1, 7)`,
  );
  application.durableCore.run(
    `INSERT INTO forgejo_delivery_attempts (surface, source_id, target)
     VALUES ('inline_feedback', ?, ?)`,
    "waiver-decision:decision-1:finding-inline",
    JSON.stringify({
      body: "Evaluation: `evaluation-1`\nAdjudication: `wrong-adjudication`\nFinding: `finding-inline`",
      commit_id: head,
      line: 2,
      path: "src/example.js",
      pull_request_number: 17,
      repository_id: 101,
      side: "RIGHT",
    }),
  );

  const response = await request("/api/v1/system", { headers });
  assert.equal(response.status, 500);
  const body = /** @type {any} */ (await response.json());
  assert.equal(body.error.code, "internal_error");
  assert.equal(body.error.message, "Internal server error");
  assert.match(body.error.request_id, /^[0-9a-f-]{36}$/);
});

test("the authenticated System API fails closed for reconciled successful delivery", async () => {
  const { application, request } = await startApplication();
  const headers = await authenticatedOperatorHeaders(request);
  arrangeGitHubFeedback(application.durableCore);
  application.durableCore.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );
  application.durableCore.run(
    `UPDATE github_commit_statuses
        SET publication_status = 'succeeded',
            published_state = desired_state,
            published_at = 11
      WHERE evaluation_id = 'evaluation-1'`,
  );
  application.durableCore.run(
    `UPDATE github_delivery_attempts
        SET connection_id = 'connection-1', authority_verified_at = 1,
            attempt_count = 1,
            last_attempt_at = 10,
            external_id = 901,
            reconciliation_required = 1,
            next_attempt_at = 0
      WHERE surface = 'commit_status'`,
  );

  const response = await request("/api/v1/system", { headers });
  assert.equal(response.status, 500);
  const body = /** @type {any} */ (await response.json());
  assert.equal(body.error.code, "internal_error");
  assert.equal(body.error.message, "Internal server error");
  assert.match(body.error.request_id, /^[0-9a-f-]{36}$/);
});

test("the authenticated System API fails closed for a succeeded delivery with a retry deadline", async () => {
  const { application, request } = await startApplication();
  const headers = await authenticatedOperatorHeaders(request);
  arrangeGitHubFeedback(application.durableCore);
  application.durableCore.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );
  application.durableCore.run(
    `UPDATE github_commit_statuses
        SET publication_status = 'succeeded',
            published_state = desired_state,
            published_at = 11
      WHERE evaluation_id = 'evaluation-1'`,
  );
  application.durableCore.run(
    `UPDATE github_delivery_attempts
        SET connection_id = 'connection-1', authority_verified_at = 1,
            attempt_count = 1,
            last_attempt_at = 10,
            external_id = 901,
            next_attempt_at = 100
      WHERE surface = 'commit_status'`,
  );

  const response = await request("/api/v1/system", { headers });
  assert.equal(response.status, 500);
  const body = /** @type {any} */ (await response.json());
  assert.equal(body.error.code, "internal_error");
  assert.equal(body.error.message, "Internal server error");
  assert.match(body.error.request_id, /^[0-9a-f-]{36}$/);
});

test("the authenticated System API applies a provider gate to every Repository", async () => {
  const { application, request } = await startApplication();
  const headers = await authenticatedOperatorHeaders(request);
  arrangeGitHubFeedback(application.durableCore);
  application.durableCore.run(
    `INSERT INTO repositories (
       id, normalized_url, created_at, verified_at
     ) VALUES ('repository-2', 'https://github.com/operator/repository-two.git', 1, 1)`,
  );
  application.durableCore.run(
    `INSERT INTO github_repositories (
       repository_id, connection_id, verification_id,
       forge_repository_id, name, api_url, web_url
     ) VALUES (
       'repository-2', 'connection-1', 'verification-1', 102,
       'operator/repository-two',
       'https://api.github.com/repos/operator/repository-two',
       'https://github.com/operator/repository-two'
     )`,
  );
  application.durableCore.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );
  application.durableCore.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 102, 'pending', 0)",
  );
  application.durableCore.run(
    "INSERT INTO quality_bar_metadata (key, value) VALUES ('github_poll_gate:connection-1', ?)",
    JSON.stringify({
      code: "provider_rate_limited",
      forgeRepositoryId: null,
      hasUnrepresentedFailureOwner: true,
      message: "Exact provider gate.",
      nextAttemptAt: 0,
      rateGateUntil: 200,
    }),
  );

  const response = await request("/api/v1/system", { headers });
  assert.equal(response.status, 200);
  const system = /** @type {any} */ (await response.json());
  const connection = system.polling.connections[0];
  assert.equal(connection.next_attempt_at, "1970-01-01T00:00:00.200Z");
  assert.equal(connection.rate_gate_until, "1970-01-01T00:00:00.200Z");
  assert.deepEqual(
    connection.repositories.map(
      /** @param {any} repository */ (repository) => ({
        next_attempt_at: repository.next_attempt_at,
        rate_gate_until: repository.rate_gate_until,
      }),
    ),
    [
      {
        next_attempt_at: "1970-01-01T00:00:00.200Z",
        rate_gate_until: "1970-01-01T00:00:00.200Z",
      },
      {
        next_attempt_at: "1970-01-01T00:00:00.200Z",
        rate_gate_until: "1970-01-01T00:00:00.200Z",
      },
    ],
  );
});

test("the authenticated System API fails closed for reconciled unavailable delivery", async () => {
  const { application, request } = await startApplication();
  const headers = await authenticatedOperatorHeaders(request);
  arrangeGitHubFeedback(application.durableCore);
  application.durableCore.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );
  application.durableCore.run(
    `UPDATE github_commit_statuses
        SET publication_status = 'unavailable',
            error_code = 'github_delivery_failed',
            error_detail = 'Exact unavailable delivery failure.'
      WHERE evaluation_id = 'evaluation-1'`,
  );
  application.durableCore.run(
    `UPDATE github_delivery_attempts
        SET connection_id = 'connection-1', authority_verified_at = 1,
            attempt_count = 1,
            last_attempt_at = 10,
            error_code = 'github_delivery_failed',
            error_detail = 'Exact unavailable delivery failure.',
            definitive = 1,
            reconciliation_required = 1,
            next_attempt_at = 0
      WHERE surface = 'commit_status'`,
  );

  const response = await request("/api/v1/system", { headers });
  assert.equal(response.status, 500);
  const body = /** @type {any} */ (await response.json());
  assert.equal(body.error.code, "internal_error");
  assert.equal(body.error.message, "Internal server error");
  assert.match(body.error.request_id, /^[0-9a-f-]{36}$/);
});
