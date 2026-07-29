import assert from "node:assert/strict";
import { test } from "node:test";

import { createGitHubFeedbackPublisher } from "../src/github-feedback-api.js";

function publisher() {
  /** @type {any[]} */
  const requests = [];
  return {
    publish: createGitHubFeedbackPublisher({
      fail(code, message) {
        throw Object.assign(new Error(message), { code });
      },
      async installationToken() {
        return "installation-token";
      },
      async request(path, options) {
        requests.push({ options, path });
        if (path.endsWith("/issues/17/comments")) {
          return { body: options.body.body, id: 701 };
        }
        return {
          body: options.body.body,
          commit_id: options.body.commit_id,
          id: 702,
          line: options.body.line,
          path: options.body.path,
          side: options.body.side,
          start_line: options.body.start_line ?? null,
          start_side: options.body.start_side ?? null,
        };
      },
    }),
    requests,
  };
}

const repository = { full_name: "operator/repository", id: 101 };

test("GitHub aggregate publication creates one pull-request timeline comment", async () => {
  const { publish, requests } = publisher();
  const externalId = await publish.publishAggregate(
    {},
    73,
    repository,
    17,
    "complete aggregate",
  );

  assert.equal(externalId, 701);
  assert.deepEqual(requests, [
    {
      options: {
        affectedRepositoryIds: [101],
        authorization: "installation-token",
        body: { body: "complete aggregate" },
        method: "POST",
        repositoryId: 101,
      },
      path: "/repos/operator/repository/issues/17/comments",
    },
  ]);
});

test("GitHub inline publication preserves exact frozen head and coordinate", async () => {
  const { publish, requests } = publisher();
  const head = "a".repeat(40);
  const externalId = await publish.publishInline({}, 73, repository, 17, {
    body: "finding feedback",
    commit_id: head,
    line: 12,
    path: "src/example.js",
    side: "LEFT",
    start_line: 14,
    start_side: "RIGHT",
  });

  assert.equal(externalId, 702);
  assert.deepEqual(requests[0], {
    options: {
      affectedRepositoryIds: [101],
      authorization: "installation-token",
      body: {
        body: "finding feedback",
        commit_id: head,
        line: 12,
        path: "src/example.js",
        side: "LEFT",
        start_line: 14,
        start_side: "RIGHT",
      },
      method: "POST",
      repositoryId: 101,
    },
    path: "/repos/operator/repository/pulls/17/comments",
  });
});

test("invalid GitHub feedback responses fail instead of inferring publication", async () => {
  const publish = createGitHubFeedbackPublisher({
    fail(code, message) {
      throw Object.assign(new Error(message), { code });
    },
    async installationToken() {
      return "installation-token";
    },
    async request() {
      return { id: 701 };
    },
  });

  await assert.rejects(
    () => publish.publishAggregate({}, 73, repository, 17, "aggregate"),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "github_api_response_invalid",
  );
});
