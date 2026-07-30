import { createIoExecutionPool } from "../src/io-execution-pool.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { createGitHubFeedbackService } from "../src/github-feedback-service.js";
import { arrangeGitHubFeedback as arrange } from "./github-feedback-publication-support.js";

test("feedback failures preserve exact owning errors without inferred success", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-feedback-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrange(core);
  const failure = Object.assign(
    new Error("GitHub Connection credential cannot be decrypted"),
    { code: "github_connection_credential_undecryptable" },
  );
  const service = createGitHubFeedbackService(core, {
    ioPool: createIoExecutionPool(),
    cipher: {
      decrypt() {
        throw failure;
      },
    },
    externalOrigin: "https://quality-bar.example",
    verifier: {
      async publishAggregateFeedback() {
        throw failure;
      },
      async publishInlineFeedback() {
        throw failure;
      },
      async reconcileAggregateFeedback() {
        throw failure;
      },
      async reconcileInlineFeedback() {
        throw failure;
      },
    },
  });

  await service.publishWaiting();
  const expected = {
    error_code: "github_connection_credential_undecryptable",
    error_detail: "GitHub Connection credential cannot be decrypted",
    external_id: null,
    publication_status: "unavailable",
  };
  assert.deepEqual(
    core.get(
      "SELECT publication_status, external_id, error_code, error_detail FROM github_feedback_bundles",
    ),
    expected,
  );
  assert.deepEqual(
    core.get(
      `SELECT health, health_error_code, health_error_message
       FROM github_connections`,
    ),
    {
      health: "error",
      health_error_code: "github_connection_credential_undecryptable",
      health_error_message: "GitHub Connection credential cannot be decrypted",
    },
  );
  assert.deepEqual(
    core.get(
      "SELECT publication_status, external_id, error_code, error_detail FROM github_finding_feedback WHERE finding_id = 'finding-inline'",
    ),
    expected,
  );
});

test("successful feedback stays successful while a rate-limited inline surface retries independently", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-feedback-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrange(core);
  let now = 0;
  let aggregates = 0;
  let inlines = 0;
  const service = createGitHubFeedbackService(core, {
    ioPool: createIoExecutionPool(),
    cipher: { decrypt: () => ({}) },
    externalOrigin: "https://quality-bar.example",
    now: () => now,
    verifier: {
      async publishAggregateFeedback() {
        aggregates += 1;
        return 701;
      },
      async publishInlineFeedback() {
        inlines += 1;
        if (inlines === 1) {
          throw new GitHubConnectionError(
            "github_api_transient_failure",
            "GitHub API request temporarily failed with HTTP 429",
            { nextAttemptAt: 60_000, responseStatus: 429 },
          );
        }
        return 702;
      },
      async reconcileAggregateFeedback() {
        return null;
      },
      async reconcileInlineFeedback() {
        return null;
      },
    },
  });

  await service.publishWaiting();
  assert.equal(aggregates, 1);
  assert.equal(inlines, 1);
  assert.deepEqual(
    core.get(
      "SELECT publication_status, external_id FROM github_feedback_bundles",
    ),
    { external_id: 701, publication_status: "succeeded" },
  );
  assert.deepEqual(
    core.get(
      `SELECT attempt_count, error_code, next_attempt_at
       FROM github_delivery_attempts
       WHERE surface = 'inline_feedback'`,
    ),
    {
      attempt_count: 1,
      error_code: "github_api_transient_failure",
      next_attempt_at: 60_000,
    },
  );
  assert.deepEqual(core.get("SELECT * FROM github_delivery_provider_gates"), {
    connection_id: "connection-1",
    error_code: "github_api_transient_failure",
    error_detail: "GitHub API request temporarily failed with HTTP 429",
    gate_until: 60_000,
  });

  now = 60_000;
  await service.publishWaiting();
  assert.equal(aggregates, 1);
  assert.equal(inlines, 2);
  assert.deepEqual(
    core.get(
      `SELECT publication_status, external_id
       FROM github_finding_feedback
       WHERE finding_id = 'finding-inline'`,
    ),
    { external_id: 702, publication_status: "succeeded" },
  );
});
