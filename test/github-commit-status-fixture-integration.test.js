import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";

import { createGitHubVerifier } from "../src/github-api.js";
import { GITHUB_COMMIT_STATUS_CONTEXT } from "../src/github-commit-status.js";

const permissions = {
  contents: "read",
  issues: "write",
  metadata: "read",
  pull_requests: "write",
  statuses: "write",
};

test("GitHub fixture receives the stable status on the exact frozen head", async (context) => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  /** @type {any[]} */
  const requests = [];
  let duplicate = false;
  const head = "a".repeat(40);
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        authorization: request.headers.authorization,
        body: body ? JSON.parse(body) : null,
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
        request.url === `/repos/operator/repository/statuses/${head}`
      ) {
        response.end(
          JSON.stringify({
            context: GITHUB_COMMIT_STATUS_CONTEXT,
            id: 901,
            sha: head,
            state: "failure",
            target_url: "https://quality-bar.example/evaluations/evaluation-1",
          }),
        );
        return;
      }
      if (
        request.method === "GET" &&
        request.url ===
          `/repos/operator/repository/commits/${head}/statuses?per_page=100&page=1`
      ) {
        const match = {
          context: GITHUB_COMMIT_STATUS_CONTEXT,
          id: 901,
          sha: head,
          state: "failure",
          target_url: "https://quality-bar.example/evaluations/evaluation-1",
        };
        response.end(
          JSON.stringify([
            match,
            ...(duplicate ? [{ ...match, id: 902 }] : []),
          ]),
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
  await verifier.publishCommitStatus(
    {
      app_id: 47,
      app_slug: "quality-bar-personal",
      client_id: "Iv1.client",
      owner: { id: 91, login: "operator", type: "User" },
      pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    },
    73,
    { full_name: "operator/repository", id: 101 },
    {
      description: "Quality Bar Evaluation is blocking",
      head,
      state: "failure",
      targetUrl: "https://quality-bar.example/evaluations/evaluation-1",
    },
  );
  assert.deepEqual(requests[1], {
    authorization: "Bearer installation-token",
    body: {
      context: GITHUB_COMMIT_STATUS_CONTEXT,
      description: "Quality Bar Evaluation is blocking",
      state: "failure",
      target_url: "https://quality-bar.example/evaluations/evaluation-1",
    },
    method: "POST",
    path: `/repos/operator/repository/statuses/${head}`,
  });
  assert.equal(
    await verifier.reconcileCommitStatus(
      {
        app_id: 47,
        app_slug: "quality-bar-personal",
        client_id: "Iv1.client",
        owner: { id: 91, login: "operator", type: "User" },
        pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      },
      73,
      { full_name: "operator/repository", id: 101 },
      {
        head,
        state: "failure",
        targetUrl: "https://quality-bar.example/evaluations/evaluation-1",
      },
    ),
    901,
  );
  duplicate = true;
  await assert.rejects(
    verifier.reconcileCommitStatus(
      {
        app_id: 47,
        app_slug: "quality-bar-personal",
        client_id: "Iv1.client",
        owner: { id: 91, login: "operator", type: "User" },
        pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      },
      73,
      { full_name: "operator/repository", id: 101 },
      {
        head,
        state: "failure",
        targetUrl: "https://quality-bar.example/evaluations/evaluation-1",
      },
    ),
    (error) =>
      /** @type {any} */ (error)?.code ===
        "github_delivery_identity_conflict" &&
      /** @type {any} */ (error).message ===
        "GitHub commit status reconciliation found duplicate source identities",
  );
  assert.equal(
    requests.at(-1).path,
    `/repos/operator/repository/commits/${head}/statuses?per_page=100&page=1`,
  );
});
