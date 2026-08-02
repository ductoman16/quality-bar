import assert from "node:assert/strict";
import { test } from "node:test";

import { createForgejoV16Publisher } from "../src/forgejo-v16.js";

test("Forgejo v16 publisher uses statuses, issue comments, and review comments on the frozen head", async () => {
  const head = "a".repeat(40);
  /** @type {any[]} */
  const requests = [];
  const publisher = createForgejoV16Publisher({
    fetch: async (url, options) => {
      const requestUrl = String(url);
      requests.push({
        body: JSON.parse(/** @type {string} */ (options?.body)),
        headers: options?.headers,
        method: options?.method,
        url,
      });
      if (requestUrl.endsWith(`/statuses/${head}`)) {
        return Response.json(
          {
            context: "Quality Bar",
            id: 901,
            sha: head,
            state: "failure",
            target_url:
              "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1",
          },
          { status: 201 },
        );
      }
      if (requestUrl.endsWith("/issues/17/comments")) {
        return Response.json({ body: "aggregate", id: 902 }, { status: 201 });
      }
      return Response.json(
        { commit_id: head, comments_count: 1, id: 903 },
        { status: 200 },
      );
    },
  });
  const connection = {
    base_url: "https://forgejo.example",
    token: "operator-pat",
  };
  const repository = { full_name: "operator/repository", id: 101 };
  assert.equal(
    await publisher.publishCommitStatus(connection, repository, {
      description: "Quality Bar Evaluation is blocking",
      head,
      state: "failure",
      targetUrl:
        "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1",
    }),
    901,
  );
  assert.equal(
    await publisher.publishAggregateFeedback(
      connection,
      repository,
      17,
      "aggregate",
    ),
    902,
  );
  assert.equal(
    await publisher.publishInlineFeedback(connection, repository, 17, {
      body: "inline",
      commit_id: head,
      line: 2,
      path: "src/example.js",
      side: "RIGHT",
    }),
    903,
  );
  assert.deepEqual(requests, [
    {
      body: {
        context: "Quality Bar",
        description: "Quality Bar Evaluation is blocking",
        state: "failure",
        target_url:
          "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1",
      },
      headers: {
        accept: "application/json",
        authorization: "token operator-pat",
        "content-type": "application/json",
      },
      method: "POST",
      url: `https://forgejo.example/api/v1/repos/operator/repository/statuses/${head}`,
    },
    {
      body: { body: "aggregate" },
      headers: {
        accept: "application/json",
        authorization: "token operator-pat",
        "content-type": "application/json",
      },
      method: "POST",
      url: "https://forgejo.example/api/v1/repos/operator/repository/issues/17/comments",
    },
    {
      body: {
        body: "",
        commit_id: head,
        comments: [
          {
            body: "inline",
            extra_lines_count: 0,
            new_position: 2,
            old_position: 0,
            path: "src/example.js",
          },
        ],
        event: "COMMENT",
      },
      headers: {
        accept: "application/json",
        authorization: "token operator-pat",
        "content-type": "application/json",
      },
      method: "POST",
      url: "https://forgejo.example/api/v1/repos/operator/repository/pulls/17/reviews",
    },
  ]);
});

test("Forgejo publication surfaces preserve exact provider failures", async () => {
  const head = "a".repeat(40);
  const publisher = createForgejoV16Publisher({
    fetch: async () => new Response("outage", { status: 503 }),
  });
  await assert.rejects(
    publisher.publishAggregateFeedback(
      { base_url: "https://forgejo.example", token: "operator-pat" },
      { full_name: "operator/repository", id: 101 },
      17,
      "aggregate",
    ),
    (error) =>
      error instanceof Error &&
      /** @type {any} */ (error).code === "forgejo_api_transient_failure" &&
      error.message ===
        "Forgejo publication route failed with HTTP 503: /api/v1/repos/operator/repository/issues/17/comments",
  );
  const invalid = createForgejoV16Publisher({
    fetch: async () =>
      Response.json(
        { context: "Quality Bar", id: 901, sha: "b".repeat(40) },
        { status: 201 },
      ),
  });
  await assert.rejects(
    invalid.publishCommitStatus(
      { base_url: "https://forgejo.example", token: "operator-pat" },
      { full_name: "operator/repository", id: 101 },
      {
        description: "Quality Bar Evaluation is active",
        head: "a".repeat(40),
        state: "pending",
        targetUrl: "https://quality-bar.example/evaluation-1",
      },
    ),
    { code: "forgejo_api_response_invalid" },
  );
  const noInlineComment = createForgejoV16Publisher({
    fetch: async () =>
      Response.json(
        { commit_id: head, comments_count: 0, id: 903 },
        { status: 200 },
      ),
  });
  await assert.rejects(
    noInlineComment.publishInlineFeedback(
      { base_url: "https://forgejo.example", token: "operator-pat" },
      { full_name: "operator/repository", id: 101 },
      17,
      {
        body: "inline",
        commit_id: head,
        line: 2,
        path: "src/example.js",
        side: "RIGHT",
      },
    ),
    { code: "forgejo_api_response_invalid" },
  );
  await assert.rejects(
    publisher.publishInlineFeedback(
      { base_url: "https://forgejo.example", token: "operator-pat" },
      { full_name: "operator/repository", id: 101 },
      17,
      {
        body: "inline",
        commit_id: head,
        line: 2,
        path: "src/example.js",
        side: "RIGHT",
        start_side: "RIGHT",
      },
    ),
    { code: "forgejo_publication_request_invalid" },
  );
});

test("Forgejo reconciliation preserves provider rate-limit delay", async () => {
  const now = Date.now();
  const rateReset = Math.ceil((now + 240_000) / 1_000);
  const publisher = createForgejoV16Publisher({
    fetch: async () =>
      new Response("rate limited", {
        headers: {
          "retry-after": "120",
          "x-ratelimit-reset": String(rateReset),
        },
        status: 429,
      }),
  });
  await assert.rejects(
    publisher.reconcileAggregateFeedback(
      { base_url: "https://forgejo.example", token: "operator-pat" },
      { full_name: "operator/repository", id: 101 },
      17,
      "aggregate",
    ),
    (error) =>
      error instanceof Error &&
      /** @type {any} */ (error).code === "forgejo_api_rate_limited" &&
      /** @type {any} */ (error).nextAttemptAt >= now + 239_000,
  );
});

test("Forgejo response ownership distinguishes transient, Connection, and Repository failures", async () => {
  const connection = {
    base_url: "https://forgejo.example",
    token: "operator-pat",
  };
  const repository = { full_name: "operator/repository", id: 101 };
  for (const [responseStatus, code, repositoryId] of /** @type {const} */ ([
    [408, "forgejo_api_transient_failure", undefined],
    [425, "forgejo_api_transient_failure", undefined],
    [401, "forgejo_connection_credential_invalid", undefined],
    [403, "forgejo_repository_permission_denied", 101],
    [404, "forgejo_repository_api_access_failed", 101],
  ])) {
    const publisher = createForgejoV16Publisher({
      fetch: async () => new Response("failure", { status: responseStatus }),
    });
    await assert.rejects(
      publisher.publishAggregateFeedback(
        connection,
        repository,
        17,
        "aggregate",
      ),
      (error) =>
        error instanceof Error &&
        /** @type {any} */ (error).code === code &&
        /** @type {any} */ (error).repositoryId === repositoryId,
    );
  }
});

test("Forgejo inline reconciliation requires the exact persisted range", async () => {
  const head = "a".repeat(40);
  const connection = {
    base_url: "https://forgejo.example",
    token: "operator-pat",
  };
  const repository = { full_name: "operator/repository", id: 101 };
  const comment = {
    body: "inline",
    commit_id: head,
    line: 5,
    path: "src/example.js",
    side: "RIGHT",
    start_line: 2,
    start_side: "RIGHT",
  };
  const responseComment = {
    body: "inline",
    commit_id: head,
    id: 902,
    original_position: 0,
    path: "src/example.js",
    position: 5,
  };
  const publisher = createForgejoV16Publisher({
    fetch: async (url) =>
      String(url).endsWith("/reviews?limit=50&page=1")
        ? Response.json([{ id: 901 }])
        : Response.json([{ ...responseComment, extra_lines_count: 1 }]),
  });
  assert.equal(
    await publisher.reconcileInlineFeedback(
      connection,
      repository,
      17,
      comment,
    ),
    null,
  );
  const duplicate = createForgejoV16Publisher({
    fetch: async (url) =>
      String(url).endsWith("/reviews?limit=50&page=1")
        ? Response.json([{ id: 901 }])
        : Response.json([
            { ...responseComment, extra_lines_count: 3 },
            { ...responseComment, extra_lines_count: 3, id: 904 },
          ]),
  });
  await assert.rejects(
    duplicate.reconcileInlineFeedback(connection, repository, 17, comment),
    { code: "forgejo_delivery_identity_conflict" },
  );
});
