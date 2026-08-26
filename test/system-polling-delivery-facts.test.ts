import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { readSystemDeliveryFacts } from "../src/system/system-delivery-facts.ts";
import { readSystemPollingFacts } from "../src/system/system-polling-facts.ts";
import { createSystemResource } from "../src/system/system-resource.ts";
import { arrangeGitHubFeedback } from "./github-feedback-publication-support.ts";
import { arrangeForgejoFeedback } from "./forgejo-feedback-publication-support.ts";
import {
  fakeGitHubDeliveryCore,
  systemDeliveryRow,
} from "./system-polling-delivery-support.ts";

function addPollingRepository(
  core: any,
  repositoryId: string,
  forgeRepositoryId: number,
  name: string,
) {
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, 1, 1)",
    repositoryId,
    `https://github.com/operator/${name}.git`,
  );
  core.run(
    `INSERT INTO github_repositories (
       repository_id, connection_id, verification_id,
       forge_repository_id, name, api_url, web_url
     ) VALUES (?, 'connection-1', 'verification-1', ?, ?, ?, ?)`,
    repositoryId,
    forgeRepositoryId,
    `operator/${name}`,
    `https://api.github.com/repos/operator/${name}`,
    `https://github.com/operator/${name}`,
  );
}

function addPollingState(
  core: any,
  forgeRepositoryId: number,
  baselineStatus: string,
  lastSuccessAt: number | null,
  errorCode: string | null,
  errorMessage: string | null,
  rateGateUntil: number | null,
  nextAttemptAt: number | null,
  snapshot: string | null,
) {
  core.run(
    `INSERT INTO github_repository_polls (
       connection_id, forge_repository_id, baseline_status,
       last_success_at, error_code, error_message,
       rate_gate_until, next_attempt_at, snapshot
     ) VALUES ('connection-1', ?, ?, ?, ?, ?, ?, ?, ?)`,
    forgeRepositoryId,
    baselineStatus,
    lastSuccessAt,
    errorCode,
    errorMessage,
    rateGateUntil,
    nextAttemptAt,
    snapshot,
  );
}

test("System exposes durable polling baselines and separate delivery outcomes with owning resources", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-system-polling-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeGitHubFeedback(core);

  core.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, last_success_at, rate_gate_until, next_attempt_at, snapshot) VALUES ('connection-1', 101, 'complete', 0, 40, 30, '[]')",
  );
  addPollingRepository(core, "repository-2", 102, "repository-two");
  addPollingState(core, 102, "pending", null, null, null, null, 0, null);
  addPollingRepository(core, "repository-3", 103, "repository-three");
  addPollingState(
    core,
    103,
    "error",
    null,
    "github_poll_failed",
    "Exact polling failure.",
    70,
    60,
    null,
  );

  core.run(
    `INSERT INTO github_finding_feedback (
       finding_id, evaluation_id, publication_status,
       path, side, line, published_at, error_code, error_detail
     ) VALUES
       ('finding-inline', 'evaluation-1', 'waiting', 'src/example.js', 'RIGHT', 2, NULL, NULL, NULL),
       ('finding-whole', 'evaluation-1', 'aggregate_only', NULL, NULL, NULL, NULL, NULL, NULL),
       ('finding-stale', 'evaluation-1', 'waiting', 'src/example.js', 'RIGHT', 10, NULL, NULL, NULL)`,
  );
  core.run(
    `UPDATE github_delivery_attempts
        SET connection_id = 'connection-1', authority_verified_at = 1,
            attempt_count = 1, last_attempt_at = 50, external_id = 501
      WHERE surface = 'commit_status' AND source_id = 'evaluation-1:failure'`,
  );
  core.run(
    `UPDATE github_commit_statuses
        SET publication_status = 'succeeded', published_state = desired_state,
            published_at = 51
      WHERE evaluation_id = 'evaluation-1'`,
  );
  core.run(
    `UPDATE github_delivery_attempts
        SET connection_id = 'connection-1', authority_verified_at = 1,
            attempt_count = 2, last_attempt_at = 60, next_attempt_at = 0,
            error_code = 'feedback_publication_failed',
            error_detail = 'Exact aggregate publication failure.',
            definitive = 1
      WHERE surface = 'aggregate_feedback' AND source_id = 'evaluation-1'`,
  );
  core.run(
    `UPDATE github_feedback_bundles
        SET publication_status = 'unavailable',
            error_code = 'feedback_publication_failed',
            error_detail = 'Exact aggregate publication failure.'
      WHERE evaluation_id = 'evaluation-1'`,
  );
  core.run(
    `UPDATE github_delivery_attempts
        SET connection_id = 'connection-1', authority_verified_at = 1,
            attempt_count = 1, last_attempt_at = 70,
            reconciliation_required = 1, next_attempt_at = 0
      WHERE surface = 'inline_feedback' AND source_id = 'finding-inline'`,
  );
  core.run(
    `UPDATE github_delivery_attempts
        SET connection_id = 'connection-1', authority_verified_at = 1,
            attempt_count = 1, last_attempt_at = 80, next_attempt_at = 300,
            error_code = 'inline_retry_waiting',
            error_detail = 'Exact retry detail.'
      WHERE surface = 'inline_feedback' AND source_id = 'finding-stale'`,
  );

  const facts = createSystemResource(core, { now: () => 100 }).readFacts({
    browserSessions: { isBootstrapped: () => true },
    codex: { status: "available" },
    implementerToken: { status: "revoked" },
    storage: { status: "available" },
  });
  const connection = facts.polling.connections[0];
  assert.equal(connection.provider, "github");
  assert.equal(connection.next_attempt_at, null);
  assert.equal(connection.rate_gate_until, null);
  assert.deepEqual(connection.external_identity, {
    app_id: 47,
    app_slug: "quality-bar",
    installation_id: 73,
    principal_id: 91,
    principal_login: "operator",
  });
  assert.deepEqual(
    connection.repositories.map((repository: any) => ({
      baseline_status: repository.baseline_status,
      error: repository.error,
      forge_repository_id: repository.forge_repository_id,
      health: repository.health,
      health_error: repository.health_error,
      last_success_at: repository.last_success_at,
      lifecycle: repository.lifecycle,
      next_attempt_at: repository.next_attempt_at,
      next_attempt_after_correction: repository.next_attempt_after_correction,
      rate_gate_until: repository.rate_gate_until,
      repository_id: repository.repository_id,
    })),
    [
      {
        baseline_status: "complete",
        error: null,
        forge_repository_id: 101,
        health: "healthy",
        health_error: null,
        last_success_at: "1970-01-01T00:00:00.000Z",
        lifecycle: "enabled",
        next_attempt_at: "1970-01-01T00:00:00.040Z",
        next_attempt_after_correction: false,
        rate_gate_until: "1970-01-01T00:00:00.040Z",
        repository_id: "repository-1",
      },
      {
        baseline_status: "pending",
        error: null,
        forge_repository_id: 102,
        health: "healthy",
        health_error: null,
        last_success_at: null,
        lifecycle: "enabled",
        next_attempt_at: null,
        next_attempt_after_correction: false,
        rate_gate_until: null,
        repository_id: "repository-2",
      },
      {
        baseline_status: "error",
        error: { code: "github_poll_failed", detail: "Exact polling failure." },
        forge_repository_id: 103,
        health: "healthy",
        health_error: null,
        last_success_at: null,
        lifecycle: "enabled",
        next_attempt_at: "1970-01-01T00:00:00.070Z",
        next_attempt_after_correction: false,
        rate_gate_until: "1970-01-01T00:00:00.070Z",
        repository_id: "repository-3",
      },
    ],
  );

  const bySource = new Map(
    facts.delivery.surfaces.map((surface) => [
      surface.source_identity,
      surface,
    ]),
  );
  assert.equal(bySource.get("evaluation-1:failure")?.status, "succeeded");
  assert.equal(bySource.get("evaluation-1:failure")?.external_id, 501);
  assert.equal(bySource.get("evaluation-1")?.status, "unavailable");
  assert.deepEqual(bySource.get("evaluation-1")?.error, {
    code: "feedback_publication_failed",
    detail: "Exact aggregate publication failure.",
  });
  assert.equal(bySource.get("finding-inline")?.status, "reconciling");
  assert.equal(bySource.get("finding-stale")?.status, "retry_scheduled");
  assert.equal(bySource.get("finding-whole")?.status, "aggregate_only");
  assert.equal(bySource.get("finding-stale")?.evaluation_id, "evaluation-1");
  assert.equal(bySource.get("finding-stale")?.repository_id, "repository-1");
  assert.equal(bySource.get("finding-stale")?.connection_id, "connection-1");
});

test("System rejects a complete baseline with an immediate next attempt", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-system-polling-now-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeGitHubFeedback(core);
  addPollingState(core, 101, "complete", 1, null, null, null, 0, "[]");

  assert.throws(
    () => readSystemPollingFacts(core),
    /github System polling repository state is invalid/,
  );
});

test("System keeps Forgejo polling and delivery identities on the same canonical surface", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-system-forgejo-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeForgejoFeedback(core, { complete: false });
  core.run(
    "INSERT INTO forgejo_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );

  const facts = createSystemResource(core, { now: () => 100 }).readFacts({
    browserSessions: { isBootstrapped: () => true },
    codex: { status: "available" },
    implementerToken: { status: "revoked" },
    storage: { status: "available" },
  });
  assert.deepEqual(facts.polling.connections, [
    {
      connection_id: "connection-1",
      error: null,
      external_identity: {
        base_url: "https://forgejo.example",
        principal_id: 91,
        principal_login: "operator",
        reported_version: "16.0.4",
      },
      health: "healthy",
      health_error: null,
      lifecycle: "enabled",
      next_attempt_at: null,
      next_attempt_after_correction: false,
      provider: "forgejo",
      rate_gate_until: null,
      repositories: [
        {
          baseline_status: "pending",
          error: null,
          forge_repository_id: 101,
          health: "healthy",
          health_error: null,
          last_success_at: null,
          lifecycle: "enabled",
          name: "operator/repository",
          next_attempt_at: null,
          next_attempt_after_correction: false,
          rate_gate_until: null,
          repository_id: "repository-1",
        },
      ],
    },
  ]);
  assert.ok(facts.delivery.surfaces.length > 0);
  assert.ok(
    facts.delivery.surfaces.every((surface) => surface.provider === "forgejo"),
  );
  assert.ok(
    facts.delivery.surfaces.every(
      (surface) =>
        surface.connection_id === "connection-1" &&
        surface.repository_id === "repository-1",
    ),
  );
});

test("System rejects partial standard delivery and mismatched external identities", () => {
  assert.throws(
    () =>
      readSystemDeliveryFacts(fakeGitHubDeliveryCore(systemDeliveryRow()), {
        now: () => 100,
      }),
    /delivery attempt is missing/,
  );
  assert.throws(
    () =>
      readSystemDeliveryFacts(
        fakeGitHubDeliveryCore(
          systemDeliveryRow({
            attempt_count: 1,
            definitive: 0,
            delivery_connection_id: "connection-1",
            external_id: 12,
            last_attempt_at: 10,
            next_attempt_at: 0,
            publication_external_id: 11,
            publication_published_at: 12,
            publication_status: "succeeded",
            reconciliation_required: 0,
          }),
        ),
        { now: () => 100 },
      ),
    /external identities disagree/,
  );
});

test("System rejects unavailable delivery with a retryable attempt", () => {
  assert.throws(
    () =>
      readSystemDeliveryFacts(
        fakeGitHubDeliveryCore(
          systemDeliveryRow({
            attempt_count: 1,
            definitive: 0,
            delivery_connection_id: "connection-1",
            error_code: "delivery_failed",
            error_detail: "Exact delivery failure.",
            last_attempt_at: 10,
            next_attempt_at: 50,
            publication_error_code: "delivery_failed",
            publication_error_detail: "Exact delivery failure.",
            publication_status: "unavailable",
            reconciliation_required: 0,
          }),
        ),
        { now: () => 100 },
      ),
    /unavailable delivery attempt is not definitive/,
  );
});

test("System never reports a reconciled delivery as succeeded", () => {
  assert.throws(
    () =>
      readSystemDeliveryFacts(
        fakeGitHubDeliveryCore(
          systemDeliveryRow({
            attempt_count: 1,
            definitive: 0,
            delivery_connection_id: "connection-1",
            external_id: 12,
            last_attempt_at: 10,
            next_attempt_at: 0,
            publication_external_id: null,
            publication_published_at: 12,
            publication_status: "succeeded",
            reconciliation_required: 1,
          }),
        ),
        { now: () => 100 },
      ),
    /succeeded delivery is reconciling/,
  );
});
