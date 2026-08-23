import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createIoExecutionPool } from "../src/io-execution-pool.js";
import { openDurableCore } from "../src/durable/durable-core.js";
import {
  EVALUATION_SELECTION,
  readEvaluation,
} from "../src/evaluation/evaluation-resource.js";
import { createForgejoPublicationServices } from "../src/forgejo/forgejo-publication-services.js";
import { arrangeForgejoFeedback as arrange } from "./forgejo-feedback-publication-support.js";

test("Forgejo completes admitted delivery after Repository disablement", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-feedback-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  const { head } = arrange(core);
  core.run("UPDATE repositories SET lifecycle = 'disabled'");
  /** @type {any[][]} */
  const statuses = [];
  /** @type {any[][]} */
  const aggregates = [];
  /** @type {any[][]} */
  const inlines = [];
  const services = createForgejoPublicationServices(core, {
    cipher: { decrypt: () => "operator-pat" },
    externalOrigin: "https://quality-bar.example",
    ioPool: createIoExecutionPool(),
    now: () => 10,
    verifier: {
      /** @param {any[]} parameters */
      async publishCommitStatus(...parameters) {
        statuses.push(parameters);
        return 901;
      },
      /** @param {any[]} parameters */
      async publishAggregateFeedback(...parameters) {
        aggregates.push(parameters);
        return 902;
      },
      /** @param {any[]} parameters */
      async publishInlineFeedback(...parameters) {
        inlines.push(parameters);
        return 903;
      },
      async reconcileAggregateFeedback() {
        throw new Error("successful aggregate must not reconcile");
      },
      async reconcileCommitStatus() {
        throw new Error("successful status must not reconcile");
      },
      async reconcileInlineFeedback() {
        throw new Error("successful inline must not reconcile");
      },
    },
  });

  await services.publishWaiting();

  assert.equal(statuses.length, 1);
  assert.deepEqual(statuses[0], [
    { base_url: "https://forgejo.example", token: "operator-pat" },
    { full_name: "operator/repository", id: 101 },
    {
      description: "Quality Bar Evaluation is blocking",
      head,
      state: "failure",
      targetUrl:
        "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1",
    },
  ]);
  assert.equal(aggregates.length, 1);
  assert.match(aggregates[0][3], /Outcome: blocking/);
  assert.match(aggregates[0][3], /finding-inline/);
  assert.match(aggregates[0][3], /finding-whole/);
  assert.match(aggregates[0][3], /finding-stale/);
  assert.equal(inlines.length, 1);
  assert.deepEqual(inlines[0].slice(1, 3), [
    { full_name: "operator/repository", id: 101 },
    17,
  ]);
  assert.deepEqual(inlines[0][3], {
    body: inlines[0][3].body,
    commit_id: head,
    line: 2,
    path: "src/example.js",
    side: "RIGHT",
  });

  assert.deepEqual(
    core.all(
      `SELECT finding_id, publication_status, external_id
       FROM forgejo_finding_feedback
       ORDER BY finding_id`,
    ),
    [
      {
        external_id: 903,
        finding_id: "finding-inline",
        publication_status: "succeeded",
      },
      {
        external_id: null,
        finding_id: "finding-stale",
        publication_status: "aggregate_only",
      },
      {
        external_id: null,
        finding_id: "finding-whole",
        publication_status: "aggregate_only",
      },
    ],
  );
  assert.deepEqual(
    core.get(
      `SELECT desired_state, publication_status, published_state,
              external_id, published_at
       FROM forgejo_commit_statuses`,
    ),
    {
      desired_state: "failure",
      external_id: 901,
      publication_status: "succeeded",
      published_at: 10,
      published_state: "failure",
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT publication_status, external_id, published_at
       FROM forgejo_feedback_bundles`,
    ),
    { external_id: 902, publication_status: "succeeded", published_at: 10 },
  );

  const resource = readEvaluation(
    core.get(
      `${EVALUATION_SELECTION} WHERE evaluations.id = ?`,
      "evaluation-1",
    ),
  );
  const resourceWithPublication = /** @type {any} */ (resource);
  assert.equal(resourceWithPublication.commit_status.state, "failure");
  assert.equal(resourceWithPublication.commit_status.external_id, 901);
  assert.equal(resourceWithPublication.feedback.aggregate.external_id, 902);
  assert.deepEqual(
    resourceWithPublication.feedback.findings.map(
      (/** @type {any} */ finding) => ({
        external_id: finding.external_id,
        finding_id: finding.finding_id,
        publication_status: finding.publication_status,
      }),
    ),
    [
      {
        external_id: 903,
        finding_id: "finding-inline",
        publication_status: "succeeded",
      },
      {
        external_id: null,
        finding_id: "finding-stale",
        publication_status: "aggregate_only",
      },
      {
        external_id: null,
        finding_id: "finding-whole",
        publication_status: "aggregate_only",
      },
    ],
  );
  assert.throws(
    () =>
      core.run(
        "DELETE FROM forgejo_feedback_bundles WHERE evaluation_id = 'evaluation-1'",
      ),
    /forgejo_feedback_bundle_immutable/,
  );
  assert.throws(
    () =>
      core.run(
        "DELETE FROM forgejo_finding_feedback WHERE finding_id = 'finding-inline'",
      ),
    /forgejo_finding_feedback_immutable/,
  );
  services.stop();
});

test("Forgejo does not start waiting publication through unhealthy ownership", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-publication-health-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrange(core);
  let aggregateCalls = 0;
  let inlineCalls = 0;
  let statusCalls = 0;
  let failAggregate = false;
  const services = createForgejoPublicationServices(core, {
    cipher: { decrypt: () => "operator-pat" },
    externalOrigin: "https://quality-bar.example",
    ioPool: createIoExecutionPool(),
    now: () => 10,
    verifier: {
      async publishCommitStatus() {
        statusCalls += 1;
        return 901;
      },
      async publishAggregateFeedback() {
        aggregateCalls += 1;
        if (failAggregate) {
          throw Object.assign(
            new Error("Forgejo Repository permission denied"),
            {
              code: "forgejo_repository_permission_denied",
              repositoryId: 101,
              responseStatus: 403,
            },
          );
        }
        return 902;
      },
      async publishInlineFeedback() {
        inlineCalls += 1;
        return 903;
      },
      async reconcileAggregateFeedback() {
        return null;
      },
      async reconcileCommitStatus() {
        return null;
      },
      async reconcileInlineFeedback() {
        return null;
      },
    },
  });
  context.after(() => services.stop());

  core.run("UPDATE forgejo_connections SET health = 'error'");
  await services.publishWaiting();
  assert.deepEqual([statusCalls, aggregateCalls, inlineCalls], [0, 0, 0]);

  core.run("UPDATE forgejo_connections SET health = 'healthy'");
  core.run(
    `UPDATE repositories
     SET health = 'error',
         health_error_code = 'forgejo_repository_permission_denied',
         health_error_message = 'Forgejo Repository permission denied'`,
  );
  await services.publishWaiting();
  assert.deepEqual([statusCalls, aggregateCalls, inlineCalls], [0, 0, 0]);

  core.run(
    `UPDATE repositories
     SET health = 'healthy', health_error_code = NULL,
         health_error_message = NULL`,
  );
  failAggregate = true;
  await services.publishWaiting();
  assert.deepEqual([statusCalls, aggregateCalls, inlineCalls], [1, 1, 0]);
});

test("Forgejo retirement makes waiting publication surfaces unavailable without reading credentials", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-feedback-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrange(core);
  core.run(
    "UPDATE repositories SET lifecycle = 'retired' WHERE id = 'repository-1'",
  );
  const { retireForgejoConnection } =
    await import("../src/forgejo/forgejo-connection-lifecycle.js");
  retireForgejoConnection(core, { lifecycle: "retired" }, () => undefined);
  assert.deepEqual(
    core.get(
      `SELECT publication_status, error_code, error_detail
       FROM forgejo_commit_statuses`,
    ),
    {
      error_code: "forgejo_connection_retired",
      error_detail:
        "Forgejo commit status publication is unavailable because the Forgejo Connection is retired",
      publication_status: "unavailable",
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT publication_status, error_code, error_detail
       FROM forgejo_feedback_bundles`,
    ),
    {
      error_code: "forgejo_connection_retired",
      error_detail:
        "Forgejo feedback publication is unavailable because the Forgejo Connection is retired",
      publication_status: "unavailable",
    },
  );
});

test("Forgejo stops definitive failures while transient sibling surfaces retain their persisted retry", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-feedback-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrange(core);
  let statusCalls = 0;
  let aggregateCalls = 0;
  let inlineCalls = 0;
  const services = createForgejoPublicationServices(core, {
    cipher: { decrypt: () => "operator-pat" },
    externalOrigin: "https://quality-bar.example",
    ioPool: createIoExecutionPool(),
    verifier: {
      async publishCommitStatus() {
        statusCalls += 1;
        throw Object.assign(
          new Error("Forgejo publication route failed with HTTP 403"),
          { code: "forgejo_api_request_failed", responseStatus: 403 },
        );
      },
      async publishAggregateFeedback() {
        aggregateCalls += 1;
        throw Object.assign(
          new Error("Forgejo publication route is unavailable"),
          { code: "forgejo_api_unavailable" },
        );
      },
      async publishInlineFeedback() {
        inlineCalls += 1;
        throw Object.assign(new Error("Forgejo inline route is unavailable"), {
          code: "forgejo_api_unavailable",
        });
      },
      async reconcileAggregateFeedback() {
        return null;
      },
      async reconcileCommitStatus() {
        return null;
      },
      async reconcileInlineFeedback() {
        return null;
      },
    },
  });

  await services.publishWaiting();
  await services.publishWaiting();

  assert.deepEqual(
    core.get(
      `SELECT publication_status, error_code, error_detail
       FROM forgejo_commit_statuses`,
    ),
    {
      error_code: "forgejo_api_request_failed",
      error_detail: "Forgejo publication route failed with HTTP 403",
      publication_status: "unavailable",
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT publication_status, error_code, error_detail
       FROM forgejo_feedback_bundles`,
    ),
    {
      error_code: null,
      error_detail: null,
      publication_status: "waiting",
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT publication_status, error_code, error_detail
       FROM forgejo_finding_feedback
       WHERE finding_id = 'finding-inline'`,
    ),
    {
      error_code: null,
      error_detail: null,
      publication_status: "waiting",
    },
  );
  assert.equal(statusCalls, 1);
  assert.equal(aggregateCalls, 1);
  assert.equal(inlineCalls, 1);
  services.stop();
});
