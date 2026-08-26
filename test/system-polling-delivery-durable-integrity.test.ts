import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { readSystemDeliveryFacts } from "../src/system/system-delivery-facts.ts";
import { readSystemPollingFacts } from "../src/system/system-polling-facts.ts";
import { timestamp } from "../src/system/system-fact-validation.ts";
import { arrangeForgejoFeedback } from "./forgejo-feedback-publication-support.ts";
import { arrangeGitHubFeedback } from "./github-feedback-publication-support.ts";
import {
  addWaiverFollowupFacts,
  fakeGitHubDeliveryCore,
  systemDeliveryRow,
} from "./system-polling-delivery-support.ts";

function openTestCore(context: any, prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  return core;
}

test("System hides Repository attempts behind lifecycle and health gates", (context) => {
  const core = openTestCore(context, "quality-bar-system-repository-gate-");
  arrangeGitHubFeedback(core);
  core.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );
  core.run(
    "UPDATE repositories SET lifecycle = 'disabled', health = 'error', health_error_code = 'repository_permission_denied', health_error_message = 'Exact Repository health failure.' WHERE id = 'repository-1'",
  );

  const [connection] = readSystemPollingFacts(core);
  assert.equal(connection.next_attempt_at, null);
  assert.deepEqual(connection.repositories[0], {
    baseline_status: "pending",
    error: {
      code: "repository_permission_denied",
      detail: "Exact Repository health failure.",
    },
    forge_repository_id: 101,
    health: "error",
    health_error: {
      code: "repository_permission_denied",
      detail: "Exact Repository health failure.",
    },
    last_success_at: null,
    lifecycle: "disabled",
    name: "operator/repository",
    next_attempt_at: null,
    next_attempt_after_correction: false,
    rate_gate_until: null,
    repository_id: "repository-1",
  });
});

test("System exposes Connection health errors and suppresses gated attempts", (context) => {
  const core = openTestCore(context, "quality-bar-system-connection-gate-");
  arrangeGitHubFeedback(core);
  core.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );
  core.run(
    "UPDATE github_connections SET health = 'error', health_error_code = 'github_connection_credential_invalid', health_error_message = 'Exact Connection health failure.' WHERE id = 'connection-1'",
  );

  const [connection] = readSystemPollingFacts(core);
  assert.deepEqual(connection.health_error, {
    code: "github_connection_credential_invalid",
    detail: "Exact Connection health failure.",
  });
  assert.deepEqual(connection.error, connection.health_error);
  assert.equal(connection.next_attempt_at, null);
  assert.equal(connection.repositories[0].next_attempt_at, null);
});

test("System rejects empty polling ownership identifiers", () => {
  const row = {
    app_id: 47,
    app_slug: "quality-bar",
    baseline_status: "pending",
    connection_health: "healthy",
    connection_health_error_code: null,
    connection_health_error_detail: null,
    connection_id: "connection-1",
    connection_lifecycle: "enabled",
    forge_repository_id: 101,
    installation_id: 73,
    last_success_at: null,
    next_attempt_at: 0,
    polling_error_code: null,
    polling_error_detail: null,
    polling_snapshot: null,
    principal_id: 91,
    principal_login: "operator",
    rate_gate_until: null,
    repository_health: "healthy",
    repository_health_error_code: null,
    repository_health_error_detail: null,
    repository_id: "repository-1",
    repository_lifecycle: "enabled",
    repository_name: "operator/repository",
  };
  const durableCore = {
    all(query: string) {
      return query.includes("FROM github_connections AS connections")
        ? [row]
        : [];
    },
  };
  row.connection_id = "";
  assert.throws(
    () => readSystemPollingFacts(durableCore),
    /System polling connection is invalid/,
  );
  row.connection_id = "connection-1";
  row.repository_id = "";
  assert.throws(
    () => readSystemPollingFacts(durableCore),
    /System polling repository is invalid/,
  );
});

test("System rejects a complete polling baseline with an invalid snapshot", (context) => {
  const core = openTestCore(context, "quality-bar-system-polling-snapshot-");
  arrangeGitHubFeedback(core);
  core.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, last_success_at, next_attempt_at, snapshot) VALUES ('connection-1', 101, 'complete', 1, 0, '{}')",
  );

  assert.throws(
    () => readSystemPollingFacts(core),
    /github System polling snapshot is invalid/,
  );
  core.run(
    "UPDATE github_repository_polls SET snapshot = '[]', next_attempt_at = NULL WHERE connection_id = 'connection-1' AND forge_repository_id = 101",
  );
  assert.throws(
    () => readSystemPollingFacts(core),
    /github System polling repository state is invalid/,
  );
});

test("System fails closed when a standard delivery publication loses its owner", (context) => {
  const core = openTestCore(context, "quality-bar-system-delivery-owner-");
  arrangeGitHubFeedback(core);
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES ('repository-2', 'https://github.com/operator/repository-two.git', 1, 1)",
  );
  core.run(
    "UPDATE github_commit_statuses SET repository_id = 'repository-2' WHERE evaluation_id = 'evaluation-1'",
  );

  assert.throws(
    () => readSystemDeliveryFacts(core),
    /github System delivery publication is orphaned/,
  );
});

test("System fails closed for an orphaned delivery attempt", (context) => {
  const core = openTestCore(context, "quality-bar-system-delivery-attempt-");
  arrangeGitHubFeedback(core);
  core.run(
    "INSERT INTO github_delivery_attempts (surface, source_id, target) VALUES ('commit_status', 'orphan:pending', '{}')",
  );

  assert.throws(
    () => readSystemDeliveryFacts(core),
    /github System delivery attempt is orphaned/,
  );
  core.run(
    "INSERT INTO github_delivery_attempts (surface, source_id, target) VALUES ('commit_status', 'evaluation-1:success', '{}')",
  );
  assert.throws(
    () => readSystemDeliveryFacts(core),
    /github System delivery attempt is orphaned/,
  );
});

test("System retains a legal historical commit delivery attempt", (context) => {
  const core = openTestCore(context, "quality-bar-system-delivery-history-");
  const { base, head } = arrangeGitHubFeedback(core);
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       base_commit, head_commit, execution_status, created_at
     ) VALUES (
       'evaluation-2', 'repository-1', 'explicit',
       'commit', ?, 'commit', ?, ?, ?, 'running', 4
     )`,
    base,
    head,
    base,
    head,
  );

  assert.doesNotThrow(() => readSystemDeliveryFacts(core));
});

test("System rejects a delivery target for another Repository", (context) => {
  const core = openTestCore(context, "quality-bar-system-delivery-target-");
  arrangeGitHubFeedback(core);
  const persistedTarget = core.get(
    "SELECT target FROM github_delivery_attempts WHERE surface = 'commit_status' AND source_id = 'evaluation-1:failure'",
  );
  assert.ok(persistedTarget);
  assert.equal(typeof persistedTarget.target, "string");
  const target = JSON.parse(persistedTarget.target as string);
  target.repository_id = 102;
  core.run(
    "UPDATE github_delivery_attempts SET target = ? WHERE surface = 'commit_status' AND source_id = 'evaluation-1:failure'",
    JSON.stringify(target),
  );

  assert.throws(
    () => readSystemDeliveryFacts(core),
    /github System commit_status delivery target is invalid/,
  );
});

test("System keeps a scoped polling failure on its Repository owner", (context) => {
  const core = openTestCore(context, "quality-bar-system-scoped-polling-");
  arrangeGitHubFeedback(core);
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
  core.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );
  core.run(
    "INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 102, 'pending', 0)",
  );
  core.run(
    "INSERT INTO quality_bar_metadata (key, value) VALUES ('github_poll_gate:connection-1', ?)",
    JSON.stringify({
      code: "github_poll_failed",
      forgeRepositoryId: 101,
      hasUnrepresentedFailureOwner: true,
      message: "Exact Repository polling failure.",
      nextAttemptAt: 200,
      rateGateUntil: null,
    }),
  );

  const [connection] = readSystemPollingFacts(core);
  assert.equal(connection.error, null);
  assert.equal(connection.next_attempt_at, null);
  assert.equal(connection.rate_gate_until, null);
  assert.deepEqual(connection.repositories[0].error, {
    code: "github_poll_failed",
    detail: "Exact Repository polling failure.",
  });
  assert.equal(
    connection.repositories[0].next_attempt_at,
    "1970-01-01T00:00:00.200Z",
  );
  assert.equal(connection.repositories[1].next_attempt_at, null);

  core.run(
    "UPDATE quality_bar_metadata SET value = ? WHERE key = 'github_poll_gate:connection-1'",
    JSON.stringify({
      code: "github_poll_failed",
      forgeRepositoryId: 999,
      hasUnrepresentedFailureOwner: true,
      message: "Unknown polling owner.",
      nextAttemptAt: 200,
      rateGateUntil: null,
    }),
  );
  assert.throws(
    () => readSystemPollingFacts(core),
    /github System polling failure owner is invalid/,
  );
});

test("System rejects an attempted delivery without Connection ownership", () => {
  assert.throws(
    () =>
      readSystemDeliveryFacts(
        fakeGitHubDeliveryCore(
          systemDeliveryRow({
            attempt_count: 1,
            definitive: 0,
            delivery_connection_id: null,
            last_attempt_at: 10,
            next_attempt_at: 0,
            reconciliation_required: 0,
          }),
        ),
        { now: () => 100 },
      ),
    /Connection ownership is missing/,
  );
});

test("System marks an unattempted unavailable waiver surface definitive", (context) => {
  const core = openTestCore(context, "quality-bar-system-waiver-unavailable-");
  const { base, head } = arrangeForgejoFeedback(core, { impact: "advisory" });
  core.run(
    "INSERT INTO forgejo_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );
  addWaiverFollowupFacts(core, base, head);
  core.run(
    "UPDATE forgejo_waiver_adjudication_followups SET publication_status = 'unavailable', error_code = 'forgejo_delivery_unavailable', error_detail = 'Exact adjudication delivery failure.' WHERE waiver_adjudication_id = 'adjudication-1'",
  );
  core.run(
    "UPDATE forgejo_waiver_decision_followups SET publication_status = 'unavailable', error_code = 'forgejo_delivery_unavailable', error_detail = 'Exact decision delivery failure.' WHERE waiver_decision_id = 'decision-1'",
  );

  const surfaces = readSystemDeliveryFacts(core).surfaces.filter(
    (surface) => surface.owner_kind !== "evaluation",
  );
  assert.equal(surfaces.length, 2);
  assert.ok(surfaces.every((surface) => surface.status === "unavailable"));
  assert.ok(surfaces.every((surface) => surface.definitive));
});

test("System rejects a waiver decision linked to another Finding", (context) => {
  const core = openTestCore(context, "quality-bar-system-waiver-owner-");
  const { base, head } = arrangeForgejoFeedback(core, { impact: "advisory" });
  core.run(
    "INSERT INTO forgejo_repository_polls (connection_id, forge_repository_id, baseline_status, next_attempt_at) VALUES ('connection-1', 101, 'pending', 0)",
  );
  core.run(
    "INSERT INTO waiver_requests (id, evaluation_id, finding_id, rationale, requester_channel, created_at) VALUES ('request-1', 'evaluation-1', 'finding-inline', 'Need a durable waiver review.', 'browser_session', 4), ('request-2', 'evaluation-1', 'finding-whole', 'Second durable waiver request.', 'browser_session', 4)",
  );
  core.run(
    `INSERT INTO waiver_adjudications (
       id, evaluation_id, base_commit, head_commit, model,
       reasoning_effort, service_tier, execution_status, created_at
     ) VALUES ('adjudication-1', 'evaluation-1', ?, ?, 'gpt-5.6-terra', 'high', 'standard', 'running', 4)`,
    base,
    head,
  );
  core.run(
    "INSERT INTO waiver_adjudication_requests (waiver_adjudication_id, waiver_request_id, position) VALUES ('adjudication-1', 'request-1', 1), ('adjudication-1', 'request-2', 2)",
  );
  core.run(
    "INSERT INTO waiver_decisions (id, waiver_adjudication_id, waiver_request_id, outcome, explanation, created_at) VALUES ('decision-1', 'adjudication-1', 'request-1', 'accepted', 'Accepted for the inline finding.', 6), ('decision-2', 'adjudication-1', 'request-2', 'accepted', 'Accepted for the whole-side finding.', 6)",
  );
  core.run(
    "UPDATE waiver_adjudications SET execution_status = 'completed', started_at = 5, completed_at = 6 WHERE id = 'adjudication-1'",
  );
  core.run(
    `INSERT INTO forgejo_waiver_decision_followups (
       waiver_decision_id, waiver_adjudication_id, finding_id,
       original_external_id, path, side, line, publication_status
     ) VALUES
       ('decision-1', 'adjudication-1', 'finding-inline', 1,
        'src/example.js', 'RIGHT', 2, 'waiting'),
       ('decision-2', 'adjudication-1', 'finding-inline', 1,
        'src/example.js', 'RIGHT', 2, 'waiting')`,
  );

  assert.throws(
    () => readSystemDeliveryFacts(core),
    /forgejo System delivery publication is orphaned/,
  );
});

test("System preserves Forgejo no-retry polling as after correction", (context) => {
  const core = openTestCore(context, "quality-bar-polling-sentinel-");
  arrangeForgejoFeedback(core, { complete: false });
  core.run(
    "INSERT INTO forgejo_repository_polls (connection_id, forge_repository_id, baseline_status, last_success_at, next_attempt_at, snapshot) VALUES ('connection-1', 101, 'pending', 1, ?, '[]')",
    Number.MAX_SAFE_INTEGER,
  );

  const [connection] = readSystemPollingFacts(core);
  assert.equal(connection.error, null);
  assert.equal(connection.repositories[0].next_attempt_at, null);
  assert.equal(connection.next_attempt_after_correction, true);
  assert.equal(connection.repositories[0].next_attempt_after_correction, true);
});

test("System rejects negative timestamps", () => {
  assert.throws(() => timestamp(-1), /timestamp is invalid/);
});
