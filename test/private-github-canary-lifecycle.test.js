import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { runPrivateGitHubCanaryLifecycle } from "../scripts/verification/private-github-canary-runner.mjs";
import { mergePrivateGitHubCanaryEvidence } from "../scripts/verification/private-github-canary.mjs";
import {
  paidCodexPass,
  privateGitHubPass,
  releaseCanarySourceCommit,
} from "./release-canary-test-fixtures.js";

function manifestWithPriorPass() {
  return {
    evidenceVersion: 1,
    failures: [],
    outcome: "pass",
    releaseCanaries: {
      paidCodex: paidCodexPass(),
      privateGitHub: privateGitHubPass(),
    },
    sourceCommit: releaseCanarySourceCommit,
    verification: { kind: "cost-free" },
  };
}

test("entrypoint lets first publication recover a retained manifest fence", () => {
  const source = readFileSync(
    new URL(
      "../scripts/verification/run-private-github-canary.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(source, /readReleaseCanaryEvidence/u);
  assert.match(source, /mergeEvidence: mergeValidatedEvidence/u);
});

test("a private GitHub attempt invalidates prior PASS before provider launch", async () => {
  /** @type {any} */ let manifest = manifestWithPriorPass();
  let launches = 0;
  const evidence = await runPrivateGitHubCanaryLifecycle({
    canaryPath: "/private.json",
    invoke: async () => {
      launches += 1;
      assert.equal(manifest.releaseCanaries.privateGitHub.outcome, "fail");
      assert.equal(
        manifest.releaseCanaries.privateGitHub.failure.code,
        "private_github_canary_attempt_started",
      );
      return privateGitHubPass();
    },
    manifestPath: "/manifest.json",
    mergeEvidence: mergePrivateGitHubCanaryEvidence,
    now: () => 1_700_000_000_000,
    publish({ canary, mergeEvidence }) {
      manifest = mergeEvidence(manifest, canary);
    },
    sourceCommit: releaseCanarySourceCommit,
  });

  assert.equal(launches, 1);
  assert.equal(evidence.outcome, "pass");
  assert.equal(manifest.releaseCanaries.privateGitHub.outcome, "pass");
  assert.equal(manifest.releaseCanaries.paidCodex.outcome, "pass");
});

test("a failed final publication replaces prior private GitHub PASS", async () => {
  /** @type {any} */ let manifest = manifestWithPriorPass();
  let publications = 0;
  const evidence = await runPrivateGitHubCanaryLifecycle({
    canaryPath: "/private.json",
    invoke: async () => privateGitHubPass(),
    manifestPath: "/manifest.json",
    mergeEvidence: mergePrivateGitHubCanaryEvidence,
    now: () => 1_700_000_000_000,
    publish({ canary, mergeEvidence }) {
      publications += 1;
      if (publications === 2) {
        throw Object.assign(new Error("canonical unavailable"), {
          code: "private_github_canary_publication_failed",
        });
      }
      manifest = mergeEvidence(manifest, canary);
    },
    sourceCommit: releaseCanarySourceCommit,
  });

  assert.equal(evidence.outcome, "fail");
  assert.equal(
    evidence.failure.code,
    "private_github_canary_publication_failed",
  );
  assert.deepEqual(manifest.releaseCanaries.privateGitHub, evidence);
  assert.equal(manifest.releaseCanaries.paidCodex.outcome, "pass");
});

test("failed private attempt publication fences provider launch", async () => {
  let launches = 0;
  await assert.rejects(
    () =>
      runPrivateGitHubCanaryLifecycle({
        canaryPath: "/private.json",
        invoke: async () => {
          launches += 1;
          return privateGitHubPass();
        },
        manifestPath: "/manifest.json",
        mergeEvidence: mergePrivateGitHubCanaryEvidence,
        publish() {
          throw Object.assign(new Error("manifest unavailable"), {
            code: "release_canary_manifest_lock_unavailable",
          });
        },
        sourceCommit: releaseCanarySourceCommit,
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "release_canary_manifest_lock_unavailable",
  );
  assert.equal(launches, 0);
});
