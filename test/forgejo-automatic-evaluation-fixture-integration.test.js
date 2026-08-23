import assert from "node:assert/strict";
import { test } from "node:test";

import { acquireForgejoAutomaticEvaluations } from "../src/forgejo/forgejo-automatic-evaluation-admission.js";
import { newlyEligibleForgejoPullRequests } from "../src/forgejo/forgejo-automatic-evaluation.js";
import { ApplicationShutdownError } from "../src/application/application-shutdown.js";
import { createForgejoV16Verifier } from "../src/forgejo/forgejo-v16.js";
import { StorageReserveError } from "../src/storage-reserve.js";

/** @param {boolean} draft @param {number} [number] @param {object} [overrides] */
function pullRequest(draft, number = 17, overrides = {}) {
  return {
    base: { sha: "a".repeat(40) },
    draft,
    head: { sha: "b".repeat(40) },
    merge_base: "c".repeat(40),
    merged: false,
    merged_at: null,
    number,
    state: "open",
    ...overrides,
  };
}

test("Forgejo v16 fixture turns a newly ready provider snapshot into acquisition input", async () => {
  const verifier = createForgejoV16Verifier({
    async fetch(url) {
      return Response.json(
        new URL(url).searchParams.get("page") === "1"
          ? [pullRequest(false)]
          : [],
      );
    },
  });
  const current = await verifier.listPullRequests(
    { baseUrl: "https://forgejo.example", token: "pat" },
    { full_name: "operator/private", id: 101 },
  );
  /** @type {{pullRequest: any, repositoryId: string}[]} */
  const acquisitions = [];

  const acquired = await acquireForgejoAutomaticEvaluations(
    [pullRequest(true)],
    current,
    "repository-1",
    async (input) => {
      acquisitions.push(input);
      return {
        base_commit: "1".repeat(40),
        head_commit: "2".repeat(40),
      };
    },
  );

  assert.deepEqual(acquisitions, [
    { pullRequest: pullRequest(false), repositoryId: "repository-1" },
  ]);
  assert.deepEqual(acquired.failures, []);
  assert.deepEqual(acquired.evaluations, [
    {
      changeset: {
        base_commit: "1".repeat(40),
        head_commit: "2".repeat(40),
      },
      provider: "forgejo",
      pullRequestNumber: 17,
      repositoryId: "repository-1",
    },
  ]);
});

test("Forgejo v16 fixture preserves reopen and pair changes while ignoring target-tip-only changes", async () => {
  let response = [
    pullRequest(false, 17, { state: "closed" }),
    pullRequest(false, 19),
  ];
  const verifier = createForgejoV16Verifier({
    async fetch(url) {
      return Response.json(
        new URL(url).searchParams.get("page") === "1" ? response : [],
      );
    },
  });
  const repository = { full_name: "operator/private", id: 101 };
  const connection = { baseUrl: "https://forgejo.example", token: "pat" };
  const previous = await verifier.listPullRequests(connection, repository);

  response = [
    pullRequest(false, 17, { head: { sha: "d".repeat(40) } }),
    pullRequest(false, 19, { base: { sha: "e".repeat(40) } }),
    pullRequest(false, 20, { merge_base: "f".repeat(40) }),
  ];
  const current = await verifier.listPullRequests(connection, repository);

  assert.deepEqual(
    newlyEligibleForgejoPullRequests(previous, current).map(
      ({ number }) => number,
    ),
    [17, 20],
  );
  assert.equal(current[0].merge_base, "c".repeat(40));
  assert.equal(current[0].head.sha, "d".repeat(40));
  assert.equal(current[1].merge_base, "c".repeat(40));
  assert.equal(current[1].base.sha, "e".repeat(40));
});

test("a Forgejo acquisition failure does not skip a later eligible Changeset", async () => {
  /** @type {number[]} */
  const attempted = [];
  const acquired = await acquireForgejoAutomaticEvaluations(
    [],
    [pullRequest(false, 17), pullRequest(false, 18), pullRequest(false, 19)],
    "repository-1",
    async ({ pullRequest: candidate }) => {
      attempted.push(candidate.number);
      if (candidate.number === 18) {
        throw Object.assign(new Error("Forgejo head is inaccessible"), {
          code: "forgejo_pull_request_head_inaccessible",
        });
      }
      return { number: candidate.number };
    },
  );
  assert.deepEqual(attempted, [17, 18, 19]);
  assert.equal(
    /** @type {any} */ (acquired.failures[0])?.code,
    "forgejo_pull_request_head_inaccessible",
  );
  assert.deepEqual(
    acquired.evaluations.map(({ pullRequestNumber }) => pullRequestNumber),
    [17, 19],
  );
});

test("an unexpected Forgejo acquisition failure releases prior work and fails immediately", async () => {
  /** @type {number[]} */
  const attempted = [];
  let releases = 0;
  await assert.rejects(
    () =>
      acquireForgejoAutomaticEvaluations(
        [],
        [
          pullRequest(false, 17),
          pullRequest(false, 18),
          pullRequest(false, 19),
        ],
        "repository-1",
        async ({ pullRequest: candidate }) => {
          attempted.push(candidate.number);
          if (candidate.number === 18) {
            throw new Error("unexpected acquisition failure");
          }
          return { release: () => (releases += 1) };
        },
      ),
    /unexpected acquisition failure/,
  );
  assert.deepEqual(attempted, [17, 18]);
  assert.equal(releases, 1);
});

for (const [label, interruption] of [
  ["application shutdown", new ApplicationShutdownError()],
  [
    "storage reserve exhaustion",
    new StorageReserveError(
      "storage_reserve_unavailable",
      "storage reserve is unavailable",
      {},
    ),
  ],
]) {
  test(`${label} releases prior Forgejo acquisitions and prevents later work`, async () => {
    /** @type {number[]} */
    const attempted = [];
    let releases = 0;
    await assert.rejects(
      () =>
        acquireForgejoAutomaticEvaluations(
          [],
          [
            pullRequest(false, 17),
            pullRequest(false, 18),
            pullRequest(false, 19),
          ],
          "repository-1",
          async ({ pullRequest: candidate }) => {
            attempted.push(candidate.number);
            if (candidate.number === 18) {
              throw interruption;
            }
            return { release: () => (releases += 1) };
          },
        ),
      (error) => error === interruption,
    );
    assert.deepEqual(attempted, [17, 18]);
    assert.equal(releases, 1);
  });
}
