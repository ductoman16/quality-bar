import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { mergePaidCodexCanaryEvidence } from "../scripts/verification/paid-codex-canary-invocation.mjs";
import { readReleaseCanaryEvidence } from "../scripts/verification/release-canary-evidence.mjs";
import { publishReleaseCanaryAttempt } from "../scripts/verification/release-canary-publication.mjs";
import {
  paidCodexPass,
  releaseCanarySourceCommit,
} from "./release-canary-test-fixtures.js";

const sourceCommit = releaseCanarySourceCommit;

function manifest() {
  return {
    evidenceVersion: 1,
    failures: [],
    outcome: "pass",
    sourceCommit,
    verification: { kind: "cost-free" },
  };
}

test("standalone publication is fenced until the canonical manifest commits", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  const canaryPath = join(directory, "paid-codex-canary.json");
  const lockPath = `${manifestPath}.release-canary.lock`;
  const canary = paidCodexPass();
  try {
    writeFileSync(manifestPath, `${JSON.stringify(manifest())}\n`);
    publishReleaseCanaryAttempt({
      canary,
      canaryPath,
      manifestPath,
      mergeEvidence: mergePaidCodexCanaryEvidence,
      writeEvidence(path, evidence) {
        assert.equal(existsSync(lockPath), true);
        assert.throws(
          () => readReleaseCanaryEvidence(manifestPath),
          (error) =>
            error instanceof Error &&
            "code" in error &&
            error.code === "release_canary_manifest_lock_unavailable",
        );
        writeFileSync(path, `${JSON.stringify(evidence)}\n`);
      },
    });
    assert.equal(existsSync(lockPath), false);
    assert.deepEqual(JSON.parse(readFileSync(canaryPath, "utf8")), canary);
    assert.deepEqual(
      readReleaseCanaryEvidence(manifestPath).releaseCanaries.paidCodex,
      canary,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("normalizes a falsy canonical publication failure", () => {
  let standaloneWrites = 0;
  assert.throws(
    () =>
      publishReleaseCanaryAttempt({
        canary: { kind: "paid-codex-canary", outcome: "pass", sourceCommit },
        canaryPath: "/artifact.json",
        manifestPath: "/manifest.json",
        mergeEvidence() {},
        updateEvidence({ beforeUpdate }) {
          beforeUpdate?.();
          runInNewContext("throw undefined");
        },
        writeEvidence() {
          standaloneWrites += 1;
        },
      }),
    /release canary publication failed/u,
  );
  assert.equal(standaloneWrites, 1);
});

test("standalone evidence publishes under the lease before the canonical manifest", () => {
  /** @type {string[]} */
  const events = [];
  publishReleaseCanaryAttempt({
    canary: { kind: "paid-codex-canary", outcome: "pass", sourceCommit },
    canaryPath: "/artifact.json",
    manifestPath: "/manifest.json",
    mergeEvidence() {},
    updateEvidence({ beforeUpdate }) {
      beforeUpdate?.();
      events.push("manifest");
    },
    writeEvidence() {
      events.push("artifact");
    },
  });
  assert.deepEqual(events, ["artifact", "manifest"]);
});

test("a canonical publication failure is surfaced after standalone publication", () => {
  let standaloneWrites = 0;
  assert.throws(
    () =>
      publishReleaseCanaryAttempt({
        canary: { kind: "paid-codex-canary", outcome: "pass", sourceCommit },
        canaryPath: "/artifact.json",
        manifestPath: "/manifest.json",
        mergeEvidence() {},
        updateEvidence({ beforeUpdate }) {
          beforeUpdate?.();
          throw new Error("canonical manifest unavailable");
        },
        writeEvidence() {
          standaloneWrites += 1;
        },
      }),
    /canonical manifest unavailable/u,
  );
  assert.equal(standaloneWrites, 1);
});

test("a standalone failure cannot publish a canonical pass", () => {
  let canonicalWrites = 0;
  assert.throws(
    () =>
      publishReleaseCanaryAttempt({
        canary: { kind: "paid-codex-canary", outcome: "pass", sourceCommit },
        canaryPath: "/artifact.json",
        manifestPath: "/manifest.json",
        mergeEvidence() {},
        updateEvidence({ beforeUpdate }) {
          beforeUpdate?.();
          canonicalWrites += 1;
        },
        writeEvidence() {
          throw new Error("standalone unavailable");
        },
      }),
    /standalone unavailable/u,
  );
  assert.equal(canonicalWrites, 0);
});
