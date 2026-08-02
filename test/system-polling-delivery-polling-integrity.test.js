import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { readSystemDeliveryFacts } from "../src/system-delivery-facts.js";
import { readSystemPollingFacts } from "../src/system-polling-facts.js";
import { createSystemResource } from "../src/system-resource.js";
import { arrangeGitHubFeedback } from "./github-feedback-publication-support.js";
import { arrangeForgejoFeedback } from "./forgejo-feedback-publication-support.js";
import {
  addWaiverFollowupFacts,
  fakeGitHubDeliveryCore,
  systemDeliveryRow,
} from "./system-polling-delivery-support.js";

const gate = JSON.stringify({
  code: "provider_rate_limited",
  forgeRepositoryId: null,
  hasUnrepresentedFailureOwner: true,
  message: "Exact provider gate.",
  nextAttemptAt: 0,
  rateGateUntil: 200,
});

/** @param {any} core */
function addSecondGitHubRepository(core) {
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES ('repository-2', 'https://github.com/operator/repository-two.git', 1, 1)",
  );
  core.run(
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
}

/** @param {any} core */
function addProviderGateAndPolls(core) {
  core.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );
  core.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 102, 'pending', 0)",
  );
  core.run(
    "INSERT INTO quality_bar_metadata (key, value) VALUES ('github_poll_gate:connection-1', ?)",
    gate,
  );
}

test("System applies a provider gate to every Repository on its Connection", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-polling-gate-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeGitHubFeedback(core);
  addSecondGitHubRepository(core);
  addProviderGateAndPolls(core);

  const connection = readSystemPollingFacts(core).find(
    (candidate) => candidate.connection_id === "connection-1",
  );
  assert.ok(connection);
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

test("System reads polling gates for each Connection instead of only the first", () => {
  const rows = [
    {
      app_id: 47,
      app_slug: "quality-bar-one",
      baseline_status: "pending",
      connection_id: "connection-1",
      connection_health: "healthy",
      connection_health_error_code: null,
      connection_health_error_detail: null,
      connection_lifecycle: "enabled",
      forge_repository_id: 101,
      installation_id: 73,
      last_success_at: null,
      next_attempt_at: 0,
      next_attempt_after_correction: false,
      polling_error_code: null,
      polling_error_detail: null,
      principal_id: 91,
      principal_login: "operator-one",
      polling_snapshot: null,
      rate_gate_until: null,
      repository_id: "repository-1",
      repository_name: "operator/one",
      repository_health: "healthy",
      repository_health_error_code: null,
      repository_health_error_detail: null,
      repository_lifecycle: "enabled",
    },
    {
      app_id: 48,
      app_slug: "quality-bar-two",
      baseline_status: "pending",
      connection_id: "connection-2",
      connection_health: "healthy",
      connection_health_error_code: null,
      connection_health_error_detail: null,
      connection_lifecycle: "enabled",
      forge_repository_id: 102,
      installation_id: 74,
      last_success_at: null,
      next_attempt_at: 0,
      next_attempt_after_correction: false,
      polling_error_code: null,
      polling_error_detail: null,
      principal_id: 92,
      principal_login: "operator-two",
      polling_snapshot: null,
      rate_gate_until: null,
      repository_id: "repository-2",
      repository_name: "operator/two",
      repository_health: "healthy",
      repository_health_error_code: null,
      repository_health_error_detail: null,
      repository_lifecycle: "enabled",
    },
  ];
  const durableCore = {
    /** @param {string} query @param {string} [key] */
    all(query, key) {
      if (query.includes("FROM github_repository_polls AS polls")) {
        return [];
      }
      if (query.includes("FROM github_connections AS connections")) {
        return rows;
      }
      if (query.includes("SELECT key FROM quality_bar_metadata")) {
        return key === "github_poll_gate:*"
          ? [{ key: "github_poll_gate:connection-1" }]
          : [];
      }
      if (query.includes("SELECT value FROM quality_bar_metadata")) {
        return key === "github_poll_gate:connection-1" ? [{ value: gate }] : [];
      }
      return [];
    },
  };

  const connections = readSystemPollingFacts(durableCore);
  assert.equal(connections.length, 2);
  assert.equal(connections[0].connection_id, "connection-1");
  assert.equal(connections[0].next_attempt_at, "1970-01-01T00:00:00.200Z");
  assert.equal(connections[1].connection_id, "connection-2");
  assert.equal(connections[1].next_attempt_at, null);
  assert.equal(connections[1].error, null);
});

test("System rejects malformed polling gate errors", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-polling-error-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeGitHubFeedback(core);
  core.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );
  core.run(
    "INSERT INTO quality_bar_metadata (key, value) VALUES ('github_poll_gate:connection-1', ?)",
    JSON.stringify({
      code: "",
      forgeRepositoryId: null,
      hasUnrepresentedFailureOwner: true,
      message: "Exact provider gate.",
      nextAttemptAt: 0,
      rateGateUntil: 200,
    }),
  );
  assert.throws(
    () => readSystemPollingFacts(core),
    /System error code is invalid/,
  );
});

test("System rejects orphaned polling rows instead of skipping them", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-polling-orphan-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeGitHubFeedback(core);
  core.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 999, 'pending', 0)",
  );
  assert.throws(
    () => readSystemPollingFacts(core),
    /github System polling repository is orphaned/,
  );
});

test("System rejects stale or incomplete succeeded delivery attempts", () => {
  assert.throws(
    () =>
      readSystemDeliveryFacts(
        fakeGitHubDeliveryCore(
          systemDeliveryRow({
            attempt_count: 0,
            definitive: 0,
            delivery_connection_id: "connection-1",
            external_id: null,
            last_attempt_at: null,
            next_attempt_at: 0,
            publication_external_id: 11,
            publication_published_at: 12,
            publication_status: "succeeded",
            reconciliation_required: 0,
          }),
        ),
        { now: () => 100 },
      ),
    /succeeded delivery attempt is incomplete/,
  );
  assert.throws(
    () =>
      readSystemDeliveryFacts(
        fakeGitHubDeliveryCore(
          systemDeliveryRow({
            attempt_count: 1,
            definitive: 0,
            delivery_connection_id: "connection-1",
            external_id: 11,
            last_attempt_at: 10,
            next_attempt_at: 50,
            publication_external_id: 11,
            publication_published_at: 12,
            publication_status: "succeeded",
            reconciliation_required: 0,
          }),
        ),
        { now: () => 100 },
      ),
    /succeeded delivery attempt is incomplete/,
  );
});

test("System keeps reconciliation next attempts behind an active provider gate", () => {
  const [surface] = readSystemDeliveryFacts(
    fakeGitHubDeliveryCore(
      systemDeliveryRow({
        attempt_count: 1,
        definitive: 0,
        delivery_connection_id: "connection-1",
        last_attempt_at: 10,
        next_attempt_at: 0,
        provider_gate_error_code: "provider_rate_limited",
        provider_gate_error_detail: "Exact provider gate.",
        provider_gate_until: 200,
        reconciliation_required: 1,
      }),
    ),
    { now: () => 100 },
  ).surfaces;
  assert.equal(surface.status, "reconciling");
  assert.equal(surface.next_attempt_at, "1970-01-01T00:00:00.200Z");
});

test("System rejects delivery ownership from another Connection", () => {
  assert.throws(
    () =>
      readSystemDeliveryFacts(
        fakeGitHubDeliveryCore(
          systemDeliveryRow({ delivery_connection_id: "connection-2" }),
        ),
        { now: () => 100 },
      ),
    /Connection ownership is invalid/,
  );
});

test("System rejects mismatched waiver evaluation ownership", () => {
  assert.throws(
    () =>
      readSystemDeliveryFacts(
        fakeGitHubDeliveryCore(
          systemDeliveryRow({
            adjudication_evaluation_id: "evaluation-2",
            adjudication_id: "adjudication-1",
            followup_evaluation_id: "evaluation-1",
            owner_kind: "adjudication",
          }),
        ),
        { now: () => 100 },
      ),
    /adjudication delivery evaluation is invalid/,
  );
  assert.throws(
    () =>
      readSystemDeliveryFacts(
        fakeGitHubDeliveryCore(
          systemDeliveryRow({
            adjudication_evaluation_id: "evaluation-1",
            adjudication_id: "adjudication-1",
            decision_id: "decision-1",
            finding_evaluation_id: "evaluation-2",
            finding_id: "finding-inline",
            owner_kind: "decision",
          }),
        ),
        { now: () => 100 },
      ),
    /decision delivery evaluation is invalid/,
  );
});

test("System keeps real unattempted waiver outcomes linked without inventing a target", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-system-waiver-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  const { base, head } = arrangeForgejoFeedback(core, { impact: "advisory" });
  core.run(
    "INSERT INTO forgejo_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );
  addWaiverFollowupFacts(core, base, head);

  const facts = createSystemResource(core, { now: () => 100 }).readFacts({
    browserSessions: { isBootstrapped: () => true },
    codex: { status: "available" },
    implementerToken: { status: "revoked" },
    storage: { status: "available" },
  });
  const byOwner = new Map(
    facts.delivery.surfaces
      .filter((surface) => surface.source_identity.startsWith("waiver-"))
      .map((surface) => [surface.owner_kind, surface]),
  );
  assert.deepEqual(
    {
      adjudication_id: byOwner.get("adjudication")?.adjudication_id,
      owner_kind: byOwner.get("adjudication")?.owner_kind,
      status: byOwner.get("adjudication")?.status,
      target: byOwner.get("adjudication")?.target,
    },
    {
      adjudication_id: "adjudication-1",
      owner_kind: "adjudication",
      status: "waiting",
      target: null,
    },
  );
  assert.deepEqual(
    {
      adjudication_id: byOwner.get("decision")?.adjudication_id,
      decision_id: byOwner.get("decision")?.decision_id,
      finding_id: byOwner.get("decision")?.finding_id,
      owner_kind: byOwner.get("decision")?.owner_kind,
      status: byOwner.get("decision")?.status,
      target: byOwner.get("decision")?.target,
    },
    {
      adjudication_id: "adjudication-1",
      decision_id: "decision-1",
      finding_id: "finding-inline",
      owner_kind: "decision",
      status: "waiting",
      target: null,
    },
  );
});
