import assert from "node:assert/strict";
import fs from "node:fs";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { mergePaidCodexCanaryEvidence } from "../scripts/verification/paid-codex-canary-invocation.mjs";
import {
  readReleaseCanaryEvidence,
  updateReleaseCanaryEvidence,
  updateVerificationEvidence,
} from "../scripts/verification/release-canary-evidence.mjs";
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

/** @param {"after-cleanup-quarantine" | "after-commit" | "after-link" | "after-unlink" | "before-transaction"} interruptAt */
function assertRecovered(interruptAt) {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  try {
    writeFileSync(manifestPath, `${JSON.stringify(manifest())}\n`);
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import fs from "node:fs";
          import { syncBuiltinESMExports } from "node:module";
          import { updateReleaseCanaryEvidence } from "./scripts/verification/release-canary-evidence.mjs";
          import { mergePaidCodexCanaryEvidence } from "./scripts/verification/paid-codex-canary-invocation.mjs";
          const manifestPath = process.argv[1];
          const interruptAt = process.argv[2];
          const originalLink = fs.linkSync;
          const originalRename = fs.renameSync;
          const originalUnlink = fs.unlinkSync;
          fs.linkSync = (source, target) => {
            if (
              interruptAt === "before-transaction" &&
              target === manifestPath + ".transaction"
            ) {
              process.kill(process.pid, "SIGKILL");
            }
            const result = originalLink(source, target);
            if (
              interruptAt === "after-commit" &&
              target === manifestPath + ".committed"
            ) {
              process.kill(process.pid, "SIGKILL");
            }
            if (
              interruptAt === "after-link" &&
              target === manifestPath &&
              source === manifestPath + ".temporary"
            ) {
              process.kill(process.pid, "SIGKILL");
            }
            return result;
          };
          fs.renameSync = (source, target) => {
            const result = originalRename(source, target);
            if (
              interruptAt === "after-cleanup-quarantine" &&
              source === manifestPath + ".previous" &&
              String(target).includes(".quality-bar-retired-")
            ) {
              process.kill(process.pid, "SIGKILL");
            }
            return result;
          };
          fs.unlinkSync = (candidate) => {
            const result = originalUnlink(candidate);
            if (
              interruptAt === "after-unlink" &&
              candidate === manifestPath
            ) {
              process.kill(process.pid, "SIGKILL");
            }
            return result;
          };
          syncBuiltinESMExports();
          updateReleaseCanaryEvidence({
            canary: ${JSON.stringify(paidCodexPass())},
            manifestPath,
            mergeEvidence: mergePaidCodexCanaryEvidence,
          });
        `,
        manifestPath,
        interruptAt,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(child.signal, "SIGKILL", child.stderr);

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
    assert.deepEqual(
      readdirSync(directory).filter((name) => name !== "evidence.json"),
      [],
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test("a missing canonical manifest is recovered after interruption", () => {
  assertRecovered("after-unlink");
});
test("an uncommitted replacement is rolled back before the next update", () => {
  assertRecovered("after-link");
});

test("a committed replacement is finalized before the next update", () => {
  assertRecovered("after-commit");
});

test("pre-marker temporary files are reclaimed after interruption", () => {
  assertRecovered("before-transaction");
});

test("a failed commit-marker fsync never exposes an unfenced replacement", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  const lockPath = `${manifestPath}.release-canary.lock`;
  const originalFsync = fs.fsyncSync;
  const originalLink = fs.linkSync;
  let committed = false;
  let injected = false;
  writeFileSync(manifestPath, `${JSON.stringify({ state: "old" })}\n`);
  try {
    fs.linkSync = (source, target) => {
      const result = originalLink(source, target);
      if (target === `${manifestPath}.committed`) {
        committed = true;
      }
      return result;
    };
    fs.fsyncSync = (descriptor) => {
      if (committed && !injected) {
        injected = true;
        throw Object.assign(new Error("injected sync failure"), {
          code: "ENOSPC",
        });
      }
      return originalFsync(descriptor);
    };
    syncBuiltinESMExports();
    assert.throws(() =>
      updateVerificationEvidence({
        manifest: { state: "new" },
        manifestPath,
        mergeEvidence: () => ({ state: "new" }),
      }),
    );
    assert.equal(injected, true);
    if (existsSync(lockPath)) {
      assert.throws(() => readReleaseCanaryEvidence(manifestPath));
    } else {
      assert.deepEqual(JSON.parse(readFileSync(manifestPath, "utf8")), {
        state: "old",
      });
    }
  } finally {
    fs.fsyncSync = originalFsync;
    fs.linkSync = originalLink;
    syncBuiltinESMExports();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("rollback rejects a byte-identical transaction marker replacement", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-evidence-"));
  const manifestPath = join(directory, "evidence.json");
  const transactionPath = `${manifestPath}.transaction`;
  const displacedPath = `${transactionPath}.displaced`;
  const previousPath = `${manifestPath}.previous`;
  const originalLink = fs.linkSync;
  writeFileSync(manifestPath, `${JSON.stringify(manifest())}\n`);
  try {
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import fs from "node:fs";
          import { syncBuiltinESMExports } from "node:module";
          import { updateReleaseCanaryEvidence } from "./scripts/verification/release-canary-evidence.mjs";
          import { mergePaidCodexCanaryEvidence } from "./scripts/verification/paid-codex-canary-invocation.mjs";
          const manifestPath = process.argv[1];
          const originalLink = fs.linkSync;
          fs.linkSync = (source, target) => {
            const result = originalLink(source, target);
            if (source === manifestPath + ".temporary" && target === manifestPath) {
              process.kill(process.pid, "SIGKILL");
            }
            return result;
          };
          syncBuiltinESMExports();
          updateReleaseCanaryEvidence({
            canary: ${JSON.stringify(paidCodexPass())},
            manifestPath,
            mergeEvidence: mergePaidCodexCanaryEvidence,
          });
        `,
        manifestPath,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(child.signal, "SIGKILL", child.stderr);

    fs.linkSync = (source, target) => {
      const result = originalLink(source, target);
      if (source === previousPath && target === manifestPath) {
        renameSync(transactionPath, displacedPath);
        writeFileSync(transactionPath, readFileSync(displacedPath), {
          flag: "wx",
          mode: 0o600,
        });
      }
      return result;
    };
    syncBuiltinESMExports();
    assert.throws(
      () =>
        updateReleaseCanaryEvidence({
          canary: paidCodexPass(),
          manifestPath,
          mergeEvidence: mergePaidCodexCanaryEvidence,
        }),
      /release canary durable transaction changed/u,
    );
    assert.deepEqual(
      readFileSync(transactionPath),
      readFileSync(displacedPath),
    );
    assert.notEqual(
      lstatSync(transactionPath).ino,
      lstatSync(displacedPath).ino,
    );
  } finally {
    fs.linkSync = originalLink;
    syncBuiltinESMExports();
    rmSync(directory, { force: true, recursive: true });
  }
});
