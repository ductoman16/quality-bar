import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validatePaidCodexCanaryEvidence,
  validatePrivateGitHubCanaryEvidence,
  validateReleaseCanaries,
  validateRetainedReleaseCanaries,
} from "../scripts/verification/release-canary-schema.mjs";
import {
  paidCodexFailure,
  paidCodexPass,
  privateGitHubFailure,
  privateGitHubPass,
  releaseCanarySourceCommit,
} from "./release-canary-test-fixtures.js";

test("accepts only complete paid Codex pass and failure evidence", () => {
  assert.doesNotThrow(() => validatePaidCodexCanaryEvidence(paidCodexPass()));
  assert.doesNotThrow(() =>
    validatePaidCodexCanaryEvidence(paidCodexFailure()),
  );
  assert.throws(
    () =>
      validatePaidCodexCanaryEvidence({
        kind: "paid-codex-canary",
        outcome: "pass",
        sourceCommit: releaseCanarySourceCommit,
      }),
    /paid Codex canary evidence is invalid/u,
  );
  assert.throws(
    () =>
      validatePaidCodexCanaryEvidence(
        paidCodexPass({ observations: { acceptedSubmission: true } }),
      ),
    /paid Codex canary evidence is invalid/u,
  );
});

test("requires a unique identifier on an in-progress paid attempt marker", () => {
  const marker = paidCodexFailure({
    failure: {
      attemptId: "00000000-0000-4000-8000-000000000001",
      code: "paid_codex_canary_attempt_started",
      detail: "paid Codex canary attempt started",
    },
  });
  assert.doesNotThrow(() => validatePaidCodexCanaryEvidence(marker));
  assert.throws(
    () =>
      validatePaidCodexCanaryEvidence({
        ...marker,
        failure: {
          code: "paid_codex_canary_attempt_started",
          detail: "paid Codex canary attempt started",
        },
      }),
    /paid Codex canary evidence is invalid/u,
  );
  assert.throws(
    () =>
      validatePaidCodexCanaryEvidence({
        ...marker,
        failure: {
          attemptId: "not-unique",
          code: "paid_codex_canary_attempt_started",
          detail: "paid Codex canary attempt started",
        },
      }),
    /paid Codex canary evidence is invalid/u,
  );
});

test("accepts only complete private GitHub pass and failure evidence", () => {
  assert.doesNotThrow(() =>
    validatePrivateGitHubCanaryEvidence(privateGitHubPass()),
  );
  assert.doesNotThrow(() =>
    validatePrivateGitHubCanaryEvidence(privateGitHubFailure()),
  );
  assert.throws(
    () =>
      validatePrivateGitHubCanaryEvidence({
        kind: "private-github-canary",
        outcome: "pass",
        sourceCommit: releaseCanarySourceCommit,
      }),
    /private GitHub canary evidence is invalid/u,
  );
});

test("rejects oversized and internally inconsistent canary evidence", () => {
  assert.throws(
    () =>
      validatePaidCodexCanaryEvidence(
        paidCodexFailure({
          failure: {
            code: "paid_codex_canary_failed",
            detail: "x".repeat(70_000),
          },
        }),
      ),
    /paid Codex canary evidence is invalid/u,
  );
  assert.throws(
    () =>
      validatePrivateGitHubCanaryEvidence(
        privateGitHubPass({
          observations: {
            ...privateGitHubPass().observations,
            exactHead: "d".repeat(40),
          },
        }),
      ),
    /private GitHub canary evidence is invalid/u,
  );
});

test("validates the complete retained release-canary set", () => {
  const canaries = {
    paidCodex: paidCodexPass(),
    privateGitHub: privateGitHubPass(),
  };
  assert.equal(
    validateReleaseCanaries(canaries, releaseCanarySourceCommit),
    canaries,
  );
  assert.throws(
    () =>
      validateReleaseCanaries(
        {
          paidCodex: {
            kind: "paid-codex-canary",
            outcome: "pass",
            sourceCommit: releaseCanarySourceCommit,
          },
        },
        releaseCanarySourceCommit,
      ),
    /release canary evidence is invalid/u,
  );
});

test("release acceptance requires both passing canaries while retention stays incremental", () => {
  const paid = paidCodexPass();
  const failure = privateGitHubFailure();
  assert.doesNotThrow(() =>
    validateRetainedReleaseCanaries(
      { paidCodex: paid },
      releaseCanarySourceCommit,
    ),
  );
  assert.doesNotThrow(() =>
    validateRetainedReleaseCanaries(
      { paidCodex: paid, privateGitHub: failure },
      releaseCanarySourceCommit,
    ),
  );
  assert.throws(
    () =>
      validateReleaseCanaries({ paidCodex: paid }, releaseCanarySourceCommit),
    /release acceptance canary evidence is invalid/u,
  );
  assert.throws(
    () =>
      validateReleaseCanaries(
        { paidCodex: paid, privateGitHub: failure },
        releaseCanarySourceCommit,
      ),
    /release acceptance canary evidence is invalid/u,
  );
});
