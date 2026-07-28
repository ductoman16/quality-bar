import assert from "node:assert/strict";
import { test } from "node:test";

import { createForgejoV16Verifier } from "../src/forgejo-v16.js";

/** @param {number} number */
function pullRequest(number) {
  return {
    base: { sha: number.toString(16).padStart(40, "a") },
    draft: false,
    head: { sha: number.toString(16).padStart(40, "b") },
    merged: false,
    merged_at: null,
    number,
    state: "open",
  };
}

test("Forgejo polling fixture completes every pull-request page", async () => {
  /** @type {string[]} */
  const paths = [];
  const verifier = createForgejoV16Verifier({
    async fetch(url) {
      const requestUrl = new URL(url);
      paths.push(`${requestUrl.pathname}${requestUrl.search}`);
      const page = Number(requestUrl.searchParams.get("page"));
      return Response.json(
        page === 1
          ? [...Array(50).keys()].map((index) => pullRequest(index + 1))
          : page === 2
            ? [pullRequest(51)]
            : [],
      );
    },
  });

  const snapshot = await verifier.listPullRequests(
    { baseUrl: "https://forgejo.example", token: "pat" },
    { full_name: "operator/private", id: 101 },
  );

  assert.equal(snapshot.length, 51);
  assert.deepEqual(paths, [
    "/api/v1/repos/operator/private/pulls?state=all&page=1&limit=50",
    "/api/v1/repos/operator/private/pulls?state=all&page=2&limit=50",
    "/api/v1/repos/operator/private/pulls?state=all&page=3&limit=50",
  ]);
});

test("Forgejo polling fixture does not mistake a server page cap for completion", async () => {
  const verifier = createForgejoV16Verifier({
    async fetch(url) {
      const page = Number(new URL(url).searchParams.get("page"));
      return Response.json(
        page === 1
          ? [pullRequest(1), pullRequest(2)]
          : page === 2
            ? [pullRequest(3)]
            : [],
      );
    },
  });

  const snapshot = await verifier.listPullRequests(
    { baseUrl: "https://forgejo.example", token: "pat" },
    { full_name: "operator/private", id: 101 },
  );

  assert.deepEqual(
    snapshot.map(({ number }) => number),
    [1, 2, 3],
  );
});

test("Forgejo polling fixture rejects an incomplete later page", async () => {
  const verifier = createForgejoV16Verifier({
    async fetch(url) {
      const page = Number(new URL(url).searchParams.get("page"));
      return Response.json(
        page === 1
          ? [...Array(50).keys()].map((index) => pullRequest(index + 1))
          : [{}],
      );
    },
  });

  await assert.rejects(
    () =>
      verifier.listPullRequests(
        { baseUrl: "https://forgejo.example", token: "pat" },
        { full_name: "operator/private", id: 101 },
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "forgejo_poll_response_invalid",
  );
});

test("Forgejo polling fixture preserves Retry-After without a hidden fallback", async () => {
  const verifier = createForgejoV16Verifier({
    async fetch() {
      return Response.json(
        { message: "rate limit exceeded" },
        { headers: { "retry-after": "120" }, status: 429 },
      );
    },
    now: () => 1_000,
  });

  await assert.rejects(
    () =>
      verifier.listPullRequests(
        { baseUrl: "https://forgejo.example", token: "pat" },
        { full_name: "operator/private", id: 101 },
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "forgejo_api_rate_limited" &&
      "nextAttemptAt" in error &&
      error.nextAttemptAt === 121_000 &&
      "rateGateUntil" in error &&
      error.rateGateUntil === 121_000 &&
      "repositoryId" in error &&
      error.repositoryId === 101,
  );
});

test("Forgejo polling fixture preserves transient seconds and date gates", async () => {
  /** @type {Array<[string, number]>} */
  const cases = [
    ["0", 1_000],
    [new Date(121_000).toUTCString(), 121_000],
  ];
  for (const [retryAfter, expected] of cases) {
    const verifier = createForgejoV16Verifier({
      async fetch() {
        return Response.json(
          { message: "unavailable" },
          { headers: { "retry-after": retryAfter }, status: 503 },
        );
      },
      now: () => 1_000,
    });
    await assert.rejects(
      () =>
        verifier.listPullRequests(
          { baseUrl: "https://forgejo.example", token: "pat" },
          { full_name: "operator/private", id: 101 },
        ),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "forgejo_api_transient_failure" &&
        "nextAttemptAt" in error &&
        error.nextAttemptAt === expected &&
        "rateGateUntil" in error &&
        error.rateGateUntil === expected,
    );
  }
});

test("Forgejo polling fixture preserves definitive and transient HTTP ownership", async () => {
  /** @type {Array<[number, string, boolean]>} */
  const cases = [
    [401, "forgejo_connection_credential_invalid", false],
    [403, "forgejo_repository_permission_denied", false],
    [404, "forgejo_repository_api_access_failed", false],
    [503, "forgejo_api_transient_failure", true],
  ];
  for (const [status, code, retry] of cases) {
    const verifier = createForgejoV16Verifier({
      async fetch() {
        return Response.json({ message: "failed" }, { status });
      },
      now: () => 1_000,
    });
    await assert.rejects(
      () =>
        verifier.listPullRequests(
          { baseUrl: "https://forgejo.example", token: "pat" },
          { full_name: "operator/private", id: 101 },
        ),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === code &&
        "nextAttemptAt" in error === retry,
    );
  }
});

test("Forgejo polling fixture rejects invalid requests and transport", async () => {
  const verifier = createForgejoV16Verifier({
    async fetch() {
      throw new Error("network unavailable");
    },
    now: () => 1_000,
  });
  await assert.rejects(
    () =>
      verifier.listPullRequests(
        { baseUrl: "https://forgejo.example", token: "" },
        { full_name: "operator/private", id: 101 },
      ),
    /Forgejo polling request is invalid/,
  );
  await assert.rejects(
    () =>
      verifier.listPullRequests(
        { baseUrl: "https://forgejo.example", token: "pat" },
        { full_name: "operator/private", id: 101 },
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "forgejo_api_unavailable" &&
      "nextAttemptAt" in error &&
      error.nextAttemptAt === 61_000 &&
      !("rateGateUntil" in error),
  );
});

test("Forgejo polling fixture rejects a non-array snapshot", async () => {
  const verifier = createForgejoV16Verifier({
    async fetch() {
      return Response.json({ items: [] });
    },
  });
  await assert.rejects(
    () =>
      verifier.listPullRequests(
        { baseUrl: "https://forgejo.example", token: "pat" },
        { full_name: "operator/private", id: 101 },
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "forgejo_poll_response_invalid",
  );
});
