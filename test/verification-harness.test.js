import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { runVerification } from "../scripts/verification/harness.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

/**
 * @param {string} directory
 * @param {string} name
 * @param {string} source
 */
function writeGateTest(directory, name, source) {
  const path = resolve(directory, `${name}.test.mjs`);
  writeFileSync(path, source);
  return path;
}

/**
 * @param {string} name
 * @param {string} testPath
 */
function gate(name, testPath) {
  return {
    name,
    testGroup: `${name}-group`,
    failureCode: `${name}_failed`,
    arguments: ["--test", testPath],
  };
}

test("the verifier emits successful evidence and stops at a hard gate failure", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "quality-bar-verifier-"));
  const nodeTestContext = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    const passingTest = writeGateTest(
      directory,
      "passing",
      'import { test } from "node:test"; test("passes", () => {});\n',
    );
    const failingTest = writeGateTest(
      directory,
      "failing",
      'import { test } from "node:test"; test("fails", () => { throw new Error("representative hard failure"); });\n',
    );
    const skippedTest = writeGateTest(
      directory,
      "skipped",
      'throw new Error("the verifier did not fail fast");\n',
    );
    const evidencePath = resolve(directory, "evidence.json");

    const successful = runVerification({
      repositoryRoot,
      manifestPath: evidencePath,
      gateDefinitions: [gate("successful-evidence", passingTest)],
    });

    assert.equal(successful.manifest.outcome, "pass");
    assert.deepEqual(successful.manifest.failures, []);
    assert.equal(
      successful.manifest.invokedGates[0].name,
      "successful-evidence",
    );
    assert.equal(successful.manifest.invokedGates[0].outcome, "pass");
    assert.match(successful.report, /Quality Bar verification: PASS/);
    assert.deepEqual(
      JSON.parse(readFileSync(evidencePath, "utf8")),
      successful.manifest,
    );

    const failed = runVerification({
      repositoryRoot,
      manifestPath: evidencePath,
      failureOutputWriter: () => {},
      gateDefinitions: [
        gate("first", passingTest),
        gate("representative-hard-failure", failingTest),
        gate("must-not-run", skippedTest),
      ],
    });

    assert.equal(failed.manifest.outcome, "fail");
    assert.deepEqual(
      failed.manifest.invokedGates.map((entry) => entry.name),
      ["first", "representative-hard-failure"],
    );
    assert.deepEqual(
      failed.manifest.failures.map((failure) => failure.code),
      ["representative-hard-failure_failed"],
    );
    assert.equal(failed.manifest.invokedGates[1].outcome, "fail");
    assert.match(failed.report, /representative-hard-failure_failed/);
    assert.deepEqual(
      JSON.parse(readFileSync(evidencePath, "utf8")),
      failed.manifest,
    );
  } finally {
    if (nodeTestContext !== undefined) {
      process.env.NODE_TEST_CONTEXT = nodeTestContext;
    }
    rmSync(directory, { force: true, recursive: true });
  }
});
