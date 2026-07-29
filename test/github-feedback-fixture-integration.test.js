import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";

import { createGitHubVerifier } from "../src/github-api.js";

const permissions = {
  contents: "read",
  issues: "write",
  metadata: "read",
  pull_requests: "write",
  statuses: "write",
};

test("GitHub fixture receives append-only aggregate and exact frozen-head inline feedback", async (context) => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  /** @type {any[]} */
  const requests = [];
  const head = "a".repeat(40);
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed = body ? JSON.parse(body) : null;
      requests.push({
        authorization: request.headers.authorization,
        body: parsed,
        method: request.method,
        path: request.url,
      });
      response.setHeader("content-type", "application/json");
      if (
        request.method === "POST" &&
        request.url === "/app/installations/73/access_tokens"
      ) {
        response.end(
          JSON.stringify({ permissions, token: "installation-token" }),
        );
        return;
      }
      if (
        request.method === "POST" &&
        request.url === "/repos/operator/repository/issues/17/comments"
      ) {
        response.end(JSON.stringify({ body: parsed.body, id: 701 }));
        return;
      }
      if (
        request.method === "POST" &&
        request.url === "/repos/operator/repository/pulls/17/comments"
      ) {
        response.end(
          JSON.stringify({
            ...parsed,
            id: 702,
            start_line: parsed.start_line ?? null,
            start_side: parsed.start_side ?? null,
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ message: "fixture route missing" }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  context.after(
    () => new Promise((resolve) => server.close(() => resolve(undefined))),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const verifier = createGitHubVerifier({
    apiBaseUrl: `http://127.0.0.1:${address.port}`,
  });
  const credential = {
    app_id: 47,
    app_slug: "quality-bar-personal",
    client_id: "Iv1.client",
    owner: { id: 91, login: "operator", type: "User" },
    pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
  const repository = { full_name: "operator/repository", id: 101 };

  assert.equal(
    await verifier.publishAggregateFeedback(
      credential,
      73,
      repository,
      17,
      "complete aggregate",
    ),
    701,
  );
  assert.equal(
    await verifier.publishInlineFeedback(credential, 73, repository, 17, {
      body: "finding feedback",
      commit_id: head,
      line: 12,
      path: "src/example.js",
      side: "RIGHT",
    }),
    702,
  );

  assert.deepEqual(requests.slice(1, 2)[0], {
    authorization: "Bearer installation-token",
    body: { body: "complete aggregate" },
    method: "POST",
    path: "/repos/operator/repository/issues/17/comments",
  });
  assert.deepEqual(requests.at(-1), {
    authorization: "Bearer installation-token",
    body: {
      body: "finding feedback",
      commit_id: head,
      line: 12,
      path: "src/example.js",
      side: "RIGHT",
    },
    method: "POST",
    path: "/repos/operator/repository/pulls/17/comments",
  });
});
