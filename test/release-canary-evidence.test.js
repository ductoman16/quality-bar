import assert from "node:assert/strict";
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { mergePaidCodexCanaryEvidence } from "../scripts/verification/paid-codex-canary-invocation.mjs";
import { writeManifest } from "../scripts/verification/manifest-reporting.mjs";
import { mergePrivateGitHubCanaryEvidence } from "../scripts/verification/private-github-canary.mjs";
import {
  readReleaseCanaryEvidence,
  updateReleaseCanaryEvidence,
} from "../scripts/verification/release-canary-evidence.mjs";
import {
  paidCodexFailure,
  paidCodexPass,
  privateGitHubFailure,
  privateGitHubPass,
  releaseCanarySourceCommit,
} from "./release-canary-test-fixtures.js";

const sourceCommit = releaseCanarySourceCommit;

/** @returns {any} */
function manifest() {
  return {
    evidenceVersion: 1,
    failures: [],
    outcome: "pass",
    sourceCommit,
    verification: { kind: "cost-free" },
  };
}

test("locked durable updates retain both release canaries", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  try {
    writeFileSync(manifestPath, `${JSON.stringify(manifest())}\n`);
    updateReleaseCanaryEvidence({
      canary: privateGitHubPass(),
      manifestPath,
      mergeEvidence: mergePrivateGitHubCanaryEvidence,
    });
    updateReleaseCanaryEvidence({
      canary: paidCodexPass(),
      manifestPath,
      mergeEvidence: mergePaidCodexCanaryEvidence,
    });
    assert.deepEqual(
      Object.keys(
        JSON.parse(readFileSync(manifestPath, "utf8")).releaseCanaries,
      ).sort(),
      ["paidCodex", "privateGitHub"],
    );
    assert.throws(() => lstatSync(`${manifestPath}.release-canary.lock`));
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a proven-stale manifest lock is reclaimed before updating", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  const lockPath = `${manifestPath}.release-canary.lock`;
  try {
    writeFileSync(manifestPath, `${JSON.stringify(manifest())}\n`);
    writeFileSync(
      lockPath,
      `${JSON.stringify({
        leaseId: "crashed-manifest-update",
        pid: process.pid,
        startIdentity: "reused-process-identity",
      })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    updateReleaseCanaryEvidence({
      canary: paidCodexPass(),
      manifestPath,
      mergeEvidence: mergePaidCodexCanaryEvidence,
    });
    assert.equal(
      JSON.parse(readFileSync(manifestPath, "utf8")).releaseCanaries.paidCodex
        .outcome,
      "pass",
    );
    assert.throws(() => lstatSync(lockPath));
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a crash-left recovery guard restores canonical lock ownership", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  const lockPath = `${manifestPath}.release-canary.lock`;
  const guardPath = `${lockPath}.recovery`;
  try {
    writeFileSync(manifestPath, `${JSON.stringify(manifest())}\n`);
    writeFileSync(
      guardPath,
      `${JSON.stringify({
        leaseId: "crashed-lock-recovery",
        pid: process.pid,
        startIdentity: "reused-process-identity",
      })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    updateReleaseCanaryEvidence({
      canary: paidCodexPass(),
      manifestPath,
      mergeEvidence: mergePaidCodexCanaryEvidence,
    });
    assert.equal(
      JSON.parse(readFileSync(manifestPath, "utf8")).releaseCanaries.paidCodex
        .outcome,
      "pass",
    );
    assert.throws(() => lstatSync(lockPath));
    assert.throws(() => lstatSync(guardPath));
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("cost-free manifest rewrites retain same-commit release canaries", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  const releaseCanaries = {
    paidCodex: paidCodexPass(),
    privateGitHub: privateGitHubPass(),
  };
  try {
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...manifest(), releaseCanaries })}\n`,
    );
    writeManifest(manifestPath, { ...manifest(), releaseCanaries: null });
    assert.deepEqual(
      JSON.parse(readFileSync(manifestPath, "utf8")).releaseCanaries,
      releaseCanaries,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("cost-free manifest rewrites retain a same-commit canary failure", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  const paidCodex = paidCodexFailure();
  try {
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        ...manifest(),
        releaseCanaries: { paidCodex },
      })}\n`,
    );
    writeManifest(manifestPath, { ...manifest(), releaseCanaries: null });
    assert.deepEqual(
      JSON.parse(readFileSync(manifestPath, "utf8")).releaseCanaries,
      { paidCodex },
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a failed retry replaces stale passing private GitHub evidence", () => {
  const failure = privateGitHubFailure();
  const merged = mergePrivateGitHubCanaryEvidence(
    {
      ...manifest(),
      releaseCanaries: {
        privateGitHub: privateGitHubPass(),
      },
    },
    failure,
  );
  assert.deepEqual(merged.releaseCanaries, { privateGitHub: failure });
});

test("cost-free manifest rewrites discard stale release canaries", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  try {
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        ...manifest(),
        releaseCanaries: {
          paidCodex: paidCodexPass(),
        },
      })}\n`,
    );
    writeManifest(manifestPath, {
      ...manifest(),
      releaseCanaries: null,
      sourceCommit: "b".repeat(40),
    });
    assert.equal(
      JSON.parse(readFileSync(manifestPath, "utf8")).releaseCanaries,
      null,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("an invalid same-commit release canary cannot replace the canonical manifest", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  const invalid = {
    ...manifest(),
    releaseCanaries: {
      paidCodex: {
        kind: "paid-codex-canary",
        outcome: "fail",
        sourceCommit,
      },
    },
  };
  try {
    writeFileSync(manifestPath, `${JSON.stringify(invalid)}\n`);
    assert.throws(
      () =>
        writeManifest(manifestPath, {
          ...manifest(),
          releaseCanaries: null,
        }),
      /existing release canary evidence is invalid/u,
    );
    assert.deepEqual(JSON.parse(readFileSync(manifestPath, "utf8")), invalid);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a replaced canonical manifest is fenced before it can be overwritten", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  const replacementPath = join(directory, "replacement.json");
  try {
    writeFileSync(manifestPath, `${JSON.stringify(manifest())}\n`);
    writeFileSync(replacementPath, '{"replacement":true}\n');
    assert.throws(
      () =>
        updateReleaseCanaryEvidence({
          canary: paidCodexPass(),
          manifestPath,
          mergeEvidence(current) {
            renameSync(replacementPath, manifestPath);
            return mergePaidCodexCanaryEvidence(current, {
              ...paidCodexPass(),
            });
          },
        }),
      /release canary manifest identity changed/u,
    );
    assert.deepEqual(JSON.parse(readFileSync(manifestPath, "utf8")), {
      replacement: true,
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a replaced parent is fenced without changing canonical evidence or stranding a lock", () => {
  const root = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const directory = join(root, "verification");
  const displaced = join(root, "displaced");
  const manifestPath = join(directory, "evidence.json");
  mkdirSync(directory);
  writeFileSync(manifestPath, `${JSON.stringify(manifest())}\n`);
  try {
    assert.throws(
      () =>
        updateReleaseCanaryEvidence({
          canary: paidCodexPass(),
          manifestPath,
          mergeEvidence(current, canary) {
            renameSync(directory, displaced);
            mkdirSync(directory);
            linkSync(join(displaced, "evidence.json"), manifestPath);
            return mergePaidCodexCanaryEvidence(current, canary);
          },
        }),
      /release canary evidence parent identity changed/u,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(manifestPath, "utf8")),
      manifest(),
    );
    assert.throws(() => lstatSync(`${manifestPath}.release-canary.lock`));
    assert.throws(() =>
      lstatSync(join(displaced, "evidence.json.release-canary.lock")),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("normalizes a falsy manifest update failure", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest())}\n`);
  try {
    assert.throws(
      () =>
        updateReleaseCanaryEvidence({
          canary: paidCodexPass(),
          manifestPath,
          mergeEvidence() {
            runInNewContext("throw undefined");
          },
        }),
      /release canary manifest update failed/u,
    );
    assert.throws(() => lstatSync(`${manifestPath}.release-canary.lock`));
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("paid preflight reads only a bounded descriptor-bound regular manifest", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  const targetPath = join(directory, "target.json");
  try {
    writeFileSync(targetPath, `${JSON.stringify(manifest())}\n`);
    symlinkSync(targetPath, manifestPath);
    assert.throws(
      () => readReleaseCanaryEvidence(manifestPath),
      /release canary manifest/u,
    );
    rmSync(manifestPath);
    writeFileSync(manifestPath, "x".repeat(1_048_577));
    assert.throws(
      () => readReleaseCanaryEvidence(manifestPath),
      /release canary manifest is too large/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
