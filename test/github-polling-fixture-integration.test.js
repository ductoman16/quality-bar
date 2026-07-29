import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { createGitHubVerifier } from "../src/github-api.js";
import { newlyEligibleGitHubPullRequests } from "../src/github-automatic-evaluation.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";

const permissions = {
  contents: "read",
  issues: "write",
  metadata: "read",
  pull_requests: "write",
  statuses: "write",
};

function credential() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    app_id: 47,
    app_slug: "quality-bar-personal",
    client_id: "Iv1.client",
    owner: { id: 91, login: "operator", type: "User" },
    pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

/** @param {number} number @param {"closed" | "open"} [state] */
function pullRequest(number, state = "open") {
  return {
    base: { sha: number.toString(16).padStart(40, "a") },
    draft: false,
    head: { sha: number.toString(16).padStart(40, "b") },
    merged_at: state === "closed" ? "2026-07-27T12:00:00Z" : null,
    number,
    state,
  };
}

test("GitHub polling fixture completes every pull-request page", async () => {
  /** @type {string[]} */
  const paths = [];
  const verifier = createGitHubVerifier({
    async fetch(url, init) {
      const requestUrl = new URL(url);
      paths.push(`${init?.method}:${requestUrl.pathname}${requestUrl.search}`);
      if (requestUrl.pathname.endsWith("/access_tokens")) {
        return Response.json({ permissions, token: "installation-token" });
      }
      const page = Number(requestUrl.searchParams.get("page"));
      return Response.json(
        page === 1
          ? Array.from(Array(100).keys(), (index) =>
              pullRequest(index + 1, index === 0 ? "closed" : "open"),
            )
          : [pullRequest(101)],
        page === 1
          ? {
              headers: {
                link: '<https://api.github.com/repos/operator/private/pulls?state=all&per_page=100&page=2>; rel="next"',
              },
            }
          : undefined,
      );
    },
  });
  const snapshot = await verifier.listPullRequests(credential(), 73, {
    full_name: "operator/private",
  });
  assert.equal(snapshot.length, 101);
  assert.deepEqual(paths.slice(-2), [
    "GET:/repos/operator/private/pulls?state=all&per_page=100&page=1",
    "GET:/repos/operator/private/pulls?state=all&per_page=100&page=2",
  ]);
  assert.equal(snapshot[0].state, "closed");
});

test("GitHub fixture observes a draft becoming ready as newly eligible", async () => {
  let draft = true;
  const verifier = createGitHubVerifier({
    async fetch(url) {
      const requestUrl = new URL(url);
      if (requestUrl.pathname.endsWith("/access_tokens")) {
        return Response.json({ permissions, token: "installation-token" });
      }
      return Response.json([{ ...pullRequest(1), draft }]);
    },
  });
  const previous = await verifier.listPullRequests(credential(), 73, {
    full_name: "operator/private",
  });
  draft = false;
  const current = await verifier.listPullRequests(credential(), 73, {
    full_name: "operator/private",
  });

  assert.deepEqual(
    newlyEligibleGitHubPullRequests(previous, current).map(
      ({ number }) => number,
    ),
    [1],
  );
});

test("GitHub polling fixture rejects truncated pagination and incomplete state", async () => {
  let page = 0;
  const verifier = createGitHubVerifier({
    async fetch(url) {
      const requestUrl = new URL(url);
      if (requestUrl.pathname.endsWith("/access_tokens")) {
        return Response.json({ permissions, token: "installation-token" });
      }
      page += 1;
      return page === 1
        ? Response.json([pullRequest(1)], {
            headers: {
              link: '<https://api.github.com/repos/operator/private/pulls?state=all&per_page=100&page=2>; rel="next"',
            },
          })
        : Response.json([{}]);
    },
  });
  await assert.rejects(
    () =>
      verifier.listPullRequests(credential(), 73, {
        full_name: "operator/private",
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_poll_response_invalid",
  );
  assert.equal(page, 2);
});

test("GitHub polling fixture rejects a last page without the required next page", async () => {
  const verifier = createGitHubVerifier({
    async fetch(url) {
      const requestUrl = new URL(url);
      if (requestUrl.pathname.endsWith("/access_tokens")) {
        return Response.json({ permissions, token: "installation-token" });
      }
      return Response.json([pullRequest(1)], {
        headers: {
          link: '<https://api.github.com/repos/operator/private/pulls?state=all&per_page=100&page=3>; rel="last"',
        },
      });
    },
  });
  await assert.rejects(
    () =>
      verifier.listPullRequests(credential(), 73, {
        full_name: "operator/private",
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_poll_response_invalid",
  );
});

test("GitHub polling fixture rejects adversarial pagination without regex backtracking", async () => {
  const verifier = createGitHubVerifier({
    async fetch(url) {
      const requestUrl = new URL(url);
      if (requestUrl.pathname.endsWith("/access_tokens")) {
        return Response.json({ permissions, token: "installation-token" });
      }
      return Response.json([pullRequest(1)], {
        headers: {
          link: `<=>;${" parameter;".repeat(10_000)} rel="next"`,
        },
      });
    },
  });
  await assert.rejects(
    () =>
      verifier.listPullRequests(credential(), 73, {
        full_name: "operator/private",
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_poll_response_invalid",
  );
});

test("GitHub polling fixture preserves the provider rate gate", async () => {
  const verifier = createGitHubVerifier({
    async fetch(url) {
      const requestUrl = new URL(url);
      if (requestUrl.pathname.endsWith("/access_tokens")) {
        return Response.json({ permissions, token: "installation-token" });
      }
      return Response.json(
        { message: "You have exceeded a secondary rate limit." },
        { headers: { "retry-after": "120" }, status: 429 },
      );
    },
    now: () => 1_000,
  });
  await assert.rejects(
    () =>
      verifier.listPullRequests(credential(), 73, {
        full_name: "operator/private",
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_api_transient_failure" &&
      error.nextAttemptAt === 121_000,
  );
});

test("GitHub polling fixture honors rate reset without an absent Retry-After fallback", async () => {
  const verifier = createGitHubVerifier({
    async fetch(url) {
      const requestUrl = new URL(url);
      if (requestUrl.pathname.endsWith("/access_tokens")) {
        return Response.json({ permissions, token: "installation-token" });
      }
      return Response.json(
        { message: "API rate limit exceeded" },
        {
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "180",
          },
          status: 403,
        },
      );
    },
    now: () => 1_000,
  });
  await assert.rejects(
    () =>
      verifier.listPullRequests(credential(), 73, {
        full_name: "operator/private",
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_api_transient_failure" &&
      error.nextAttemptAt === 180_000,
  );
});
