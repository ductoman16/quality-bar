import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { createForgejoVerifier } from "../src/forgejo/forgejo-verifier.js";
import { formatWaiverDecisionFollowup } from "../src/waiver/waiver-followup.js";

test("Forgejo fixture accepts the exact status, aggregate, and inline publication routes", async (context) => {
  const head = "a".repeat(40);
  const waiverBody = formatWaiverDecisionFollowup(
    {
      adjudication_id: "adjudication-1",
      base_commit: "b".repeat(40),
      details_url:
        "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1",
      evaluation_id: "evaluation-1",
      head_commit: head,
      outcome: "clear",
    },
    {
      explanation: "The exact exception is justified.",
      finding_id: "finding-1",
      outcome: "accepted",
      request_id: "request-1",
    },
  );
  /** @type {any[]} */
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://fixture.invalid");
      requests.push({
        authorization: request.headers.authorization,
        body: body === "" ? null : JSON.parse(body),
        method: request.method,
        path: url.pathname,
      });
      response.setHeader("content-type", "application/json");
      if (
        request.method === "GET" &&
        url.pathname.endsWith(`/statuses/${head}`)
      ) {
        response.end(
          JSON.stringify([
            {
              context: "Quality Bar",
              description: "Quality Bar Evaluation is blocking",
              id: 901,
              status: "failure",
              target_url: "https://quality-bar.example/evaluation-1",
            },
          ]),
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname.endsWith("/issues/17/comments")
      ) {
        response.end(JSON.stringify([{ body: "aggregate", id: 902 }]));
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname.endsWith("/pulls/17/reviews")
      ) {
        response.end(JSON.stringify([{ id: 903 }]));
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname.endsWith("/reviews/903/comments")
      ) {
        response.end(
          JSON.stringify([
            {
              body: waiverBody,
              commit_id: head,
              extra_lines_count: 0,
              id: 904,
              original_position: 0,
              path: "src/example.js",
              position: 2,
            },
          ]),
        );
        return;
      }
      if (url.pathname.endsWith(`/statuses/${head}`)) {
        response.statusCode = 201;
        response.end(
          JSON.stringify({
            context: "Quality Bar",
            id: 901,
            sha: head,
            state: "failure",
            target_url: "https://quality-bar.example/evaluation-1",
          }),
        );
        return;
      }
      if (url.pathname.endsWith("/issues/17/comments")) {
        response.statusCode = 201;
        response.end(JSON.stringify({ body: "aggregate", id: 902 }));
        return;
      }
      response.statusCode = 200;
      response.end(
        JSON.stringify({ commit_id: head, comments_count: 1, id: 903 }),
      );
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const verifier = createForgejoVerifier();
  const connection = {
    base_url: `http://127.0.0.1:${address.port}`,
    token: "operator-pat",
  };
  const repository = { full_name: "operator/repository", id: 101 };
  assert.equal(
    await verifier.publishCommitStatus(connection, repository, {
      description: "Quality Bar Evaluation is blocking",
      head,
      state: "failure",
      targetUrl: "https://quality-bar.example/evaluation-1",
    }),
    901,
  );
  assert.equal(
    await verifier.publishAggregateFeedback(
      connection,
      repository,
      17,
      "aggregate",
    ),
    902,
  );
  assert.equal(
    await verifier.publishInlineFeedback(connection, repository, 17, {
      body: waiverBody,
      commit_id: head,
      line: 2,
      path: "src/example.js",
      side: "RIGHT",
    }),
    903,
  );
  assert.equal(
    await verifier.reconcileCommitStatus(connection, repository, {
      description: "Quality Bar Evaluation is blocking",
      head,
      state: "failure",
      targetUrl: "https://quality-bar.example/evaluation-1",
    }),
    901,
  );
  assert.equal(
    await verifier.reconcileAggregateFeedback(
      connection,
      repository,
      17,
      "aggregate",
    ),
    902,
  );
  assert.equal(
    await verifier.reconcileInlineFeedback(connection, repository, 17, {
      body: waiverBody,
      commit_id: head,
      line: 2,
      path: "src/example.js",
      side: "RIGHT",
    }),
    903,
  );
  assert.deepEqual(
    requests.map(({ method, path }) => ({ method, path })),
    [
      {
        method: "POST",
        path: `/api/v1/repos/operator/repository/statuses/${head}`,
      },
      {
        method: "POST",
        path: "/api/v1/repos/operator/repository/issues/17/comments",
      },
      {
        method: "POST",
        path: "/api/v1/repos/operator/repository/pulls/17/reviews",
      },
      {
        method: "GET",
        path: `/api/v1/repos/operator/repository/statuses/${head}`,
      },
      {
        method: "GET",
        path: "/api/v1/repos/operator/repository/issues/17/comments",
      },
      {
        method: "GET",
        path: "/api/v1/repos/operator/repository/pulls/17/reviews",
      },
      {
        method: "GET",
        path: "/api/v1/repos/operator/repository/pulls/17/reviews/903/comments",
      },
    ],
  );
  assert.ok(
    requests.every(
      ({ authorization }) => authorization === "token operator-pat",
    ),
  );
});
