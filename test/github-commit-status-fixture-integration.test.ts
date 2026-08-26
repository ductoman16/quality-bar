import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";

import { createGitHubVerifier } from "../src/github/github-api.ts";
import { COMMIT_STATUS_CONTEXT as GITHUB_COMMIT_STATUS_CONTEXT } from "../src/forge/commit-status/status.ts";

const permissions = {
  contents: "read",
  issues: "write",
  metadata: "read",
  pull_requests: "write",
  statuses: "write",
};

test("GitHub fixture receives the stable status on the exact frozen head", async (context) => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const requests: any[] = [];
  let shaShape: "matching" | "mismatched" | "null" | "omitted" = "matching";
  let duplicate = false;
  let matchOverrides: Record<string, unknown> = {};
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
            state: "failure",
            target_url:
              "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1",
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
          ...(shaShape === "omitted"
            ? {}
            : { sha: shaShape === "null" ? null : head }),
          state: "failure",
          target_url:
            "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1",
        };
        if (shaShape === "mismatched") {
          match.sha = "b".repeat(40);
        }
        const candidate = { ...match, ...matchOverrides };
        response.end(
          JSON.stringify([
            candidate,
            ...(duplicate ? [{ ...candidate, id: 902 }] : []),
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
  const credential = {
    app_id: 47,
    app_slug: "quality-bar-personal",
    client_id: "Iv1.client",
    owner: { id: 91, login: "operator", type: "User" },
    pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
  const repository = { full_name: "operator/repository", id: 101 };
  const status = {
    head,
    state: "failure",
    targetUrl:
      "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1",
  };
  const reconcile = () =>
    verifier.reconcileCommitStatus(credential, 73, repository, status);
  await verifier.publishCommitStatus(credential, 73, repository, {
    description: "Quality Bar Evaluation is blocking",
    ...status,
  });
  assert.deepEqual(requests[1], {
    authorization: "Bearer installation-token",
    body: {
      context: GITHUB_COMMIT_STATUS_CONTEXT,
      description: "Quality Bar Evaluation is blocking",
      state: "failure",
      target_url:
        "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1",
    },
    method: "POST",
    path: `/repos/operator/repository/statuses/${head}`,
  });
  assert.equal(await reconcile(), 901);
  shaShape = "omitted";
  assert.equal(await reconcile(), 901);
  shaShape = "null";
  assert.equal(await reconcile(), 901);
  shaShape = "mismatched";
  await assert.rejects(
    reconcile(),
    (error) =>
      (error as any)?.code === "github_api_response_invalid" &&
      (error as any).message ===
        "GitHub commit status reconciliation response is invalid",
  );
  shaShape = "omitted";
  matchOverrides = { context: "Other" };
  assert.equal(await reconcile(), null);
  matchOverrides = { state: "success" };
  assert.equal(await reconcile(), null);
  matchOverrides = {
    target_url:
      "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-2",
  };
  assert.equal(await reconcile(), null);
  matchOverrides = {};
  assert.equal(
    await verifier.reconcileCommitStatus(credential, 73, repository, {
      ...status,
      targetUrl:
        "https://changed.example/?view=evaluations&evaluation_id=evaluation-1",
    }),
    901,
  );
  duplicate = true;
  await assert.rejects(
    reconcile(),
    (error) =>
      (error as any)?.code === "github_delivery_identity_conflict" &&
      (error as any).message ===
        "GitHub commit status reconciliation found duplicate source identities",
  );
  assert.equal(
    requests.at(-1).path,
    `/repos/operator/repository/commits/${head}/statuses?per_page=100&page=1`,
  );
});
