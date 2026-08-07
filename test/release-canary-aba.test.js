import assert from "node:assert/strict";
import fs from "node:fs";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { mergePaidCodexCanaryEvidence } from "../scripts/verification/paid-codex-canary-invocation.mjs";
import {
  readReleaseCanaryEvidence,
  updateReleaseCanaryEvidence,
} from "../scripts/verification/release-canary-evidence.mjs";
import { writeDurableJson } from "../scripts/verification/release-canary-files.mjs";
import { publishReleaseCanaryAttempt } from "../scripts/verification/release-canary-publication.mjs";
import {
  paidCodexPass,
  releaseCanarySourceCommit,
} from "./release-canary-test-fixtures.js";

function manifest() {
  return {
    evidenceVersion: 1,
    failures: [],
    outcome: "pass",
    sourceCommit: releaseCanarySourceCommit,
    verification: { kind: "cost-free" },
  };
}

test("durable publication never overwrites a foreign quarantine destination", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  const originalLink = fs.linkSync;
  let foreignPath = "";
  let intercepted = false;
  writeFileSync(manifestPath, `${JSON.stringify(manifest())}\n`);
  try {
    fs.linkSync = (source, target) => {
      if (
        !intercepted &&
        source === manifestPath &&
        target === `${manifestPath}.previous`
      ) {
        intercepted = true;
        foreignPath = String(target);
        writeFileSync(foreignPath, "foreign\n", {
          flag: "wx",
          mode: 0o600,
        });
      }
      return originalLink(source, target);
    };
    syncBuiltinESMExports();

    assert.throws(
      () => writeDurableJson(manifestPath, { ...manifest(), updated: true }),
      /exist|publication|cleanup/iu,
    );
    assert.equal(intercepted, true);
    assert.equal(readFileSync(foreignPath, "utf8"), "foreign\n");
    assert.deepEqual(
      JSON.parse(readFileSync(manifestPath, "utf8")),
      manifest(),
    );
  } finally {
    fs.linkSync = originalLink;
    syncBuiltinESMExports();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a split publication retains its manifest fence", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  const canaryPath = join(directory, "paid-codex-canary.json");
  const replacementPath = join(directory, "replacement.json");
  const lockPath = `${manifestPath}.release-canary.lock`;
  const canary = paidCodexPass();
  writeFileSync(manifestPath, `${JSON.stringify(manifest())}\n`);
  try {
    assert.throws(
      () =>
        publishReleaseCanaryAttempt({
          canary,
          canaryPath,
          manifestPath,
          mergeEvidence: mergePaidCodexCanaryEvidence,
          writeEvidence(path, evidence) {
            writeFileSync(path, `${JSON.stringify(evidence)}\n`);
            writeFileSync(replacementPath, `${JSON.stringify(manifest())}\n`);
            renameSync(replacementPath, manifestPath);
          },
        }),
      /release canary manifest identity changed/u,
    );
    assert.deepEqual(JSON.parse(readFileSync(canaryPath, "utf8")), canary);
    assert.equal(existsSync(lockPath), true);
    assert.throws(
      () => readReleaseCanaryEvidence(manifestPath),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "release_canary_manifest_lock_unavailable",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("manifest publication never adopts a byte-identical lock replacement", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  const canaryPath = join(directory, "paid-codex-canary.json");
  const lockPath = `${manifestPath}.release-canary.lock`;
  const displacedLockPath = `${lockPath}.displaced`;
  const originalLink = fs.linkSync;
  let standaloneWrites = 0;
  let intercepted = false;
  writeFileSync(manifestPath, `${JSON.stringify(manifest())}\n`);
  try {
    fs.linkSync = (source, target) => {
      const result = originalLink(source, target);
      if (
        !intercepted &&
        target === lockPath &&
        source === `${lockPath}.temporary`
      ) {
        intercepted = true;
        renameSync(lockPath, displacedLockPath);
        writeFileSync(lockPath, readFileSync(displacedLockPath), {
          flag: "wx",
          mode: 0o600,
        });
      }
      return result;
    };
    syncBuiltinESMExports();
    assert.throws(
      () =>
        publishReleaseCanaryAttempt({
          canary: paidCodexPass(),
          canaryPath,
          manifestPath,
          mergeEvidence: mergePaidCodexCanaryEvidence,
          writeEvidence() {
            standaloneWrites += 1;
          },
        }),
      /release canary manifest (?:lock changed|update is already in progress)/u,
    );
    assert.equal(standaloneWrites, 0);
    assert.equal(existsSync(lockPath), true);
    assert.equal(existsSync(displacedLockPath), true);
  } finally {
    fs.linkSync = originalLink;
    syncBuiltinESMExports();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("parent replacement during publication leaves the old canonical manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const directory = join(root, "verification");
  const displaced = join(root, "verification-displaced");
  const manifestPath = join(directory, "evidence.json");
  const originalLink = fs.linkSync;
  let intercepted = false;
  mkdirSync(directory);
  writeFileSync(manifestPath, `${JSON.stringify(manifest())}\n`);
  try {
    fs.linkSync = (source, target) => {
      if (!intercepted && target === manifestPath) {
        intercepted = true;
        renameSync(directory, displaced);
        mkdirSync(directory);
        linkSync(join(displaced, "evidence.json.previous"), manifestPath);
        const sourceName = source
          .toString()
          .slice(source.toString().lastIndexOf("/") + 1);
        renameSync(source, join(directory, sourceName));
        source = join(directory, sourceName);
      }
      return originalLink(source, target);
    };
    syncBuiltinESMExports();
    assert.throws(() =>
      updateReleaseCanaryEvidence({
        canary: paidCodexPass(),
        manifestPath,
        mergeEvidence: mergePaidCodexCanaryEvidence,
      }),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(manifestPath, "utf8")),
      manifest(),
    );
  } finally {
    fs.linkSync = originalLink;
    syncBuiltinESMExports();
    rmSync(root, { force: true, recursive: true });
  }
});
