import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createIoExecutionPool } from "../src/io-execution-pool.ts";
import { createGitHubVerifier } from "../src/github/github-api.ts";
import { createGitHubFeedbackService } from "../src/github/github-feedback-service.ts";
import { attemptGitHubDelivery } from "../src/github/github-delivery-service.ts";
import { createForgejoFeedbackService } from "../src/forgejo/forgejo-feedback-service.ts";
import { createForgejoPublisher } from "../src/forgejo/forgejo-verifier.ts";
import { attemptForgejoDelivery } from "../src/forgejo/forgejo-delivery-service.ts";
import { openDurableCore } from "../src/durable/durable-core.ts";
import { arrangeForgejoFeedback } from "./forgejo-feedback-publication-support.ts";
import { arrangeGitHubFeedback } from "./github-feedback-publication-support.ts";

const permissions = {
  contents: "read",
  issues: "write",
  metadata: "read",
  pull_requests: "write",
  statuses: "write",
};

test("GitHub aggregate recovery proves absence before exactly one replacement create", async (context) => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const body = "Quality Bar aggregate";
  const requests: { method: string; path: string }[] = [];
  let creates = 0;
  let unresolvedCreates = 0;
  const verifier = createGitHubVerifier({
    fetch: async (requestUrl: any, options = {}) => {
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
        url.pathname === "/repos/operator/repository/issues/17/comments"
      ) {
        creates += 1;
        const payload =
          typeof options.body === "string"
            ? JSON.parse(options.body)
            : options.body;
        return creates === 1
          ? Response.json({})
          : Response.json({ body: payload.body, id: 907 });
      }
      if (
        options.method === "POST" &&
        url.pathname === "/repos/operator/repository/pulls/17/comments"
      ) {
        const payload =
          typeof options.body === "string"
            ? JSON.parse(options.body)
            : options.body;
        return Response.json({
          ...payload,
          id: 909,
          start_line: payload.start_line ?? null,
          start_side: payload.start_side ?? null,
        });
      }
      if (
        options.method === "POST" &&
        url.pathname === "/repos/operator/repository/issues/18/comments"
      ) {
        unresolvedCreates += 1;
        return Response.json({});
      }
      if (
        options.method === "GET" &&
        url.pathname === "/repos/operator/repository/issues/17/comments"
      ) {
        return Response.json([]);
      }
      if (
        options.method === "GET" &&
        url.pathname === "/repos/operator/repository/issues/18/comments"
      ) {
        return Response.json({ message: "temporary outage" }, { status: 503 });
      }
      throw new Error(`unexpected GitHub aggregate route: ${url}`);
    },
    now: () => 1_000,
  });
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-provider-recovery-adapter-github-aggregate-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeGitHubFeedback(core);
  const credential = {
    app_id: 47,
    app_slug: "quality-bar",
    client_id: "Iv1.client",
    owner: { id: 91, login: "operator", type: "User" },
    pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
  const repository = { full_name: "operator/repository", id: 101 };
  let now = 0;
  const service = createGitHubFeedbackService(core, {
    cipher: { decrypt: () => credential },
    externalOrigin: "https://quality-bar.example",
    ioPool: createIoExecutionPool(),
    now: () => now,
    verifier,
  });

  await service.publishWaiting();
  now = 60_000;
  await service.publishWaiting();

  assert.equal(creates, 2);
  assert.equal(
    requests.filter(
      ({ method, path }) =>
        method === "GET" && path.endsWith("/issues/17/comments"),
    ).length,
    1,
  );
  assert.deepEqual(
    core.get(
      `SELECT external_id, reconciliation_required, error_code
         FROM github_delivery_attempts
        WHERE surface = 'aggregate_feedback'
          AND source_id = 'evaluation-1'`,
    ),
    { error_code: null, external_id: 907, reconciliation_required: 0 },
  );

  assert.deepEqual(
    core.get(
      `SELECT publication_status, external_id, error_code
         FROM github_feedback_bundles
        WHERE evaluation_id = 'evaluation-1'`,
    ),
    { error_code: null, external_id: 907, publication_status: "succeeded" },
  );

  const operations: string[] = [];
  const operationCount = operations.length;
  const unresolvedInput = {
    connectionId: "connection-1",
    create: async (target: string) => {
      operations.push("create");
      const value = JSON.parse(target);
      return verifier.publishAggregateFeedback(
        credential,
        73,
        repository,
        value.pullRequestNumber,
        value.body,
      );
    },
    now: () => 0,
    onDefinitive() {},
    onSuccess() {},
    reconcile: async (target: string) => {
      operations.push("reconcile");
      const value = JSON.parse(target);
      return verifier.reconcileAggregateFeedback(
        credential,
        73,
        repository,
        value.pullRequestNumber,
        value.body,
      );
    },
    sourceId: "adapter-github-aggregate-unresolved",
    surface: "aggregate_feedback" as "aggregate_feedback",
    target: JSON.stringify({ body, pullRequestNumber: 18 }),
  };
  await attemptGitHubDelivery(core, unresolvedInput);
  unresolvedInput.now = () => 60_000;
  await attemptGitHubDelivery(core, unresolvedInput);
  assert.deepEqual(operations.slice(operationCount), ["create", "reconcile"]);
  assert.equal(unresolvedCreates, 1);
  assert.deepEqual(
    core.get(
      `SELECT external_id, reconciliation_required, error_code
         FROM github_delivery_attempts
        WHERE surface = 'aggregate_feedback'
          AND source_id = 'adapter-github-aggregate-unresolved'`,
    ),
    {
      error_code: "github_api_transient_failure",
      external_id: null,
      reconciliation_required: 1,
    },
  );
});

test("Forgejo aggregate recovery proves absence before exactly one replacement create", async (context) => {
  const body = "Quality Bar aggregate";
  const requests: { method: string; path: string }[] = [];
  let creates = 0;
  let unresolvedCreates = 0;
  const publisher = createForgejoPublisher({
    fetch: async (requestUrl: any, options = {}) => {
      const url = new URL(requestUrl);
      requests.push({ method: options.method ?? "GET", path: url.pathname });
      if (
        options.method === "POST" &&
        url.pathname === "/api/v1/repos/operator/repository/issues/17/comments"
      ) {
        creates += 1;
        const payload =
          typeof options.body === "string"
            ? JSON.parse(options.body)
            : options.body;
        return creates === 1
          ? Response.json({}, { status: 201 })
          : Response.json({ body: payload.body, id: 908 }, { status: 201 });
      }
      if (
        options.method === "POST" &&
        url.pathname === "/api/v1/repos/operator/repository/pulls/17/reviews"
      ) {
        const payload =
          typeof options.body === "string"
            ? JSON.parse(options.body)
            : options.body;
        return Response.json(
          { commit_id: payload.commit_id, comments_count: 1, id: 909 },
          { status: 200 },
        );
      }
      if (
        options.method === "POST" &&
        url.pathname === "/api/v1/repos/operator/repository/issues/18/comments"
      ) {
        unresolvedCreates += 1;
        return Response.json({}, { status: 201 });
      }
      if (
        (options.method ?? "GET") === "GET" &&
        url.pathname === "/api/v1/repos/operator/repository/issues/17/comments"
      ) {
        return Response.json([]);
      }
      if (
        (options.method ?? "GET") === "GET" &&
        url.pathname === "/api/v1/repos/operator/repository/issues/18/comments"
      ) {
        return Response.json({ message: "temporary outage" }, { status: 503 });
      }
      throw new Error(`unexpected Forgejo aggregate route: ${url}`);
    },
  });
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-provider-recovery-adapter-forgejo-aggregate-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeForgejoFeedback(core);
  const connection = {
    base_url: "https://forgejo.example",
    token: "pat",
  };
  const repository = { full_name: "operator/repository", id: 101 };
  let now = 0;
  const service = createForgejoFeedbackService(core, {
    cipher: { decrypt: () => "pat" },
    externalOrigin: "https://quality-bar.example",
    ioPool: createIoExecutionPool(),
    now: () => now,
    verifier: publisher,
  });

  await service.publishWaiting();
  now = 60_000;
  await service.publishWaiting();

  assert.equal(creates, 2);
  assert.equal(
    requests.filter(
      ({ method, path }) =>
        method === "GET" && path.endsWith("/issues/17/comments"),
    ).length,
    1,
  );
  assert.deepEqual(
    core.get(
      `SELECT external_id, reconciliation_required, error_code
         FROM forgejo_delivery_attempts
        WHERE surface = 'aggregate_feedback'
          AND source_id = 'evaluation-1'`,
    ),
    { error_code: null, external_id: 908, reconciliation_required: 0 },
  );
  assert.deepEqual(
    core.get(
      `SELECT publication_status, external_id, error_code
         FROM forgejo_feedback_bundles
        WHERE evaluation_id = 'evaluation-1'`,
    ),
    { error_code: null, external_id: 908, publication_status: "succeeded" },
  );

  const operations: string[] = [];
  const unresolvedInput: Parameters<typeof attemptForgejoDelivery>[1] = {
    connectionId: "connection-1",
    create: async (target: string) => {
      operations.push("create");
      const value = JSON.parse(target);
      return publisher.publishAggregateFeedback(
        connection,
        repository,
        value.pullRequestNumber,
        value.body,
      );
    },
    now: () => 0,
    onDefinitive() {},
    onSuccess() {},
    reconcile: async (target: string) => {
      operations.push("reconcile");
      const value = JSON.parse(target);
      return publisher.reconcileAggregateFeedback(
        connection,
        repository,
        value.pullRequestNumber,
        value.body,
      );
    },
    repositoryId: "repository-1",
    sourceId: "adapter-forgejo-aggregate-unresolved",
    surface: "aggregate_feedback" as "aggregate_feedback",
    target: JSON.stringify({ body, pullRequestNumber: 18 }),
  };

  const operationCount = operations.length;
  await attemptForgejoDelivery(core, unresolvedInput);
  unresolvedInput.now = () => 60_000;
  await attemptForgejoDelivery(core, unresolvedInput);
  assert.deepEqual(operations.slice(operationCount), ["create", "reconcile"]);
  assert.equal(unresolvedCreates, 1);
  assert.deepEqual(
    core.get(
      `SELECT external_id, reconciliation_required, error_code
         FROM forgejo_delivery_attempts
        WHERE surface = 'aggregate_feedback'
          AND source_id = 'adapter-forgejo-aggregate-unresolved'`,
    ),
    {
      error_code: "forgejo_api_transient_failure",
      external_id: null,
      reconciliation_required: 1,
    },
  );
});
