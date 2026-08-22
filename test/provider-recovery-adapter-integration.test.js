import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createIoExecutionPool } from "../src/io-execution-pool.js";
import { createGitHubVerifier } from "../src/github/github-api.js";
import { createGitHubCommitStatusService } from "../src/github/github-commit-status-service.js";
import { createForgejoCommitStatusService } from "../src/forgejo/forgejo-commit-status-service.js";
import { createForgejoV16Publisher } from "../src/forgejo/forgejo-v16.js";
import { openDurableCore } from "../src/durable/durable-core.js";
import { arrangeForgejoFeedback } from "./forgejo-feedback-publication-support.js";
import { arrangeGitHubCommitStatus } from "./github-commit-status-publication-support.js";

const permissions = {
  contents: "read",
  issues: "write",
  metadata: "read",
  pull_requests: "write",
  statuses: "write",
};

test("GitHub publication service recovers a malformed adapter response before success", async (context) => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const head = "2".repeat(40);
  const targetUrl =
    "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1";
  /** @type {{method: string, path: string}[]} */
  const requests = [];
  const verifier = createGitHubVerifier({
    fetch: async (requestUrl, options = {}) => {
      const url = new URL(requestUrl);
      requests.push({ method: options.method ?? "GET", path: url.pathname });
      if (
        options.method === "POST" &&
        url.pathname === "/app/installations/73/access_tokens"
      ) {
        return Response.json({ permissions, token: "installation-token" });
      }
      if (
        options.method === "POST" &&
        url.pathname === `/repos/operator/repository/statuses/${head}`
      ) {
        return Response.json({});
      }
      if (
        options.method === "GET" &&
        url.pathname === `/repos/operator/repository/commits/${head}/statuses`
      ) {
        return Response.json([
          {
            context: "Quality Bar",
            id: 903,
            sha: head,
            state: "pending",
            target_url: targetUrl,
          },
        ]);
      }
      throw new Error(`unexpected GitHub adapter route: ${url}`);
    },
    now: () => 1_000,
  });
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-provider-recovery-adapter-github-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeGitHubCommitStatus(core);
  let now = 0;
  const service = createGitHubCommitStatusService(core, {
    cipher: {
      decrypt: () => ({
        client_id: "Iv1.client",
        pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      }),
    },
    externalOrigin: "https://quality-bar.example",
    ioPool: createIoExecutionPool(),
    now: () => now,
    verifier,
  });

  await service.publishWaiting();
  now = 60_000;
  await service.publishWaiting();

  assert.equal(
    requests.filter(
      ({ method, path }) =>
        method === "POST" && path.endsWith(`/statuses/${head}`),
    ).length,
    1,
  );
  assert.equal(
    requests.filter(
      ({ method, path }) =>
        method === "GET" && path.endsWith(`/commits/${head}/statuses`),
    ).length,
    1,
  );
  assert.deepEqual(
    core.get(
      `SELECT publication_status, error_code, error_detail
         FROM github_commit_statuses
        WHERE evaluation_id = 'evaluation-1'`,
    ),
    {
      error_code: null,
      error_detail: null,
      publication_status: "succeeded",
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT external_id, reconciliation_required, error_code
         FROM github_delivery_attempts
        WHERE surface = 'commit_status'
          AND source_id = 'evaluation-1:pending'`,
    ),
    { error_code: null, external_id: 903, reconciliation_required: 0 },
  );
});

test("Forgejo publication service recovers a malformed adapter response before success", async (context) => {
  const head = "2".repeat(40);
  const targetUrl =
    "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1";
  /** @type {{method: string, path: string}[]} */
  const requests = [];
  const publisher = createForgejoV16Publisher({
    fetch: async (requestUrl, options = {}) => {
      const url = new URL(requestUrl);
      requests.push({ method: options.method ?? "GET", path: url.pathname });
      if (
        options.method === "POST" &&
        url.pathname === `/api/v1/repos/operator/repository/statuses/${head}`
      ) {
        return Response.json({}, { status: 201 });
      }
      if (
        (options.method ?? "GET") === "GET" &&
        url.pathname === `/api/v1/repos/operator/repository/statuses/${head}`
      ) {
        return Response.json([
          {
            context: "Quality Bar",
            description: "Quality Bar Evaluation is blocking",
            id: 904,
            sha: head,
            state: "failure",
            target_url: targetUrl,
          },
        ]);
      }
      throw new Error(`unexpected Forgejo adapter route: ${url}`);
    },
  });
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-provider-recovery-adapter-forgejo-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeForgejoFeedback(core);
  let now = 0;
  const service = createForgejoCommitStatusService(core, {
    cipher: { decrypt: () => "pat" },
    externalOrigin: "https://quality-bar.example",
    ioPool: createIoExecutionPool(),
    now: () => now,
    verifier: publisher,
  });

  await service.publishWaiting();
  now = 60_000;
  await service.publishWaiting();

  assert.equal(
    requests.filter(
      ({ method, path }) =>
        method === "POST" && path.endsWith(`/statuses/${head}`),
    ).length,
    1,
  );
  assert.equal(
    requests.filter(
      ({ method, path }) =>
        method === "GET" && path.endsWith(`/statuses/${head}`),
    ).length,
    1,
  );
  assert.deepEqual(
    core.get(
      `SELECT publication_status, external_id, error_code
         FROM forgejo_commit_statuses
        WHERE evaluation_id = 'evaluation-1'`,
    ),
    {
      error_code: null,
      external_id: 904,
      publication_status: "succeeded",
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT external_id, reconciliation_required, error_code
         FROM forgejo_delivery_attempts
        WHERE surface = 'commit_status'
          AND source_id = 'evaluation-1:failure'`,
    ),
    { error_code: null, external_id: 904, reconciliation_required: 0 },
  );
});
