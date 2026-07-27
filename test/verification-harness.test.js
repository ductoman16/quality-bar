import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { createGateDefinitions } from "../scripts/verification/gate-definitions.mjs";
import { runVerification } from "../scripts/verification/harness.mjs";
import { readVerificationMetadata } from "../scripts/verification/metadata.mjs";

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
    assert.equal(
      successful.manifest.componentVersions.adapterProtocol,
      "mcp:2025-11-25",
    );
    assert.equal(
      successful.manifest.componentVersions.fixtures,
      "github-rest:2026-03-10",
    );
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

test("the canonical verifier starts with six named static-quality gates", () => {
  const definitions = createGateDefinitions({
    applicationVersion: "1.2.3",
    coverageToolVersion: "12.0.0",
    eslintPluginNodeVersion: "18.2.2",
    eslintVersion: "9.39.1",
    formatterVersion: "3.7.4",
    jsonSchemaFormatsVersion: "3.0.1",
    jsonSchemaValidatorVersion: "8.20.0",
    openApiValidatorVersion: "2.9.0",
    typeCheckerVersion: "7.0.2",
  });

  assert.deepEqual(
    definitions.slice(0, 6).map((definition) => definition.name),
    [
      "formatting",
      "structural-lint",
      "correctness-lint",
      "node-ownership-lint",
      "production-type-check",
      "proof-code-type-check",
    ],
  );
  assert.deepEqual(
    definitions.slice(0, 6).map((definition) => definition.failureCode),
    [
      "formatting_failed",
      "structural_lint_failed",
      "correctness_lint_failed",
      "node_ownership_lint_failed",
      "production_type_check_failed",
      "proof_code_type_check_failed",
    ],
  );
  for (const definition of definitions.slice(0, 6)) {
    assert.equal(definition.command, "npm");
    assert.ok((definition.checkGroups?.length ?? 0) > 0);
    assert.equal(definition.tools?.node, process.version);
  }
  const coverage = definitions.find(
    (definition) => definition.name === "application-coverage",
  );
  assert.ok(coverage);
  assert.equal(coverage.command, "npm");
  assert.deepEqual(coverage.arguments, ["run", "coverage"]);
  assert.equal(coverage.factsMarker, "QUALITY_BAR_APPLICATION_COVERAGE_FACTS");
  assert.deepEqual(coverage.tools, { c8: "12.0.0", node: process.version });
  const coverageProof = definitions.find(
    (definition) => definition.name === "application-coverage-proof",
  );
  assert.ok(coverageProof);
  assert.deepEqual(coverageProof.arguments, [
    "--test",
    "test/application-coverage-policy.test.js",
    "test/application-coverage-ledger.test.js",
    "test/application-coverage-history.test.js",
  ]);
  const openApiStructure = definitions.find(
    (definition) => definition.name === "openapi-structure",
  );
  assert.ok(openApiStructure);
  assert.deepEqual(openApiStructure.arguments, ["run", "openapi:check"]);
  assert.deepEqual(openApiStructure.tools, {
    ajv: "8.20.0",
    "ajv-formats": "3.0.1",
    node: process.version,
    "openapi-schema-validator": "2.9.0",
  });
  const openApiRuntime = definitions.find(
    (definition) => definition.name === "openapi-runtime-conformance",
  );
  assert.ok(openApiRuntime);
  assert.deepEqual(openApiRuntime.arguments, [
    "--test",
    "test/openapi-conformance.test.js",
  ]);
  assert.deepEqual(openApiRuntime.tools, openApiStructure.tools);
  const mcpIntegration = definitions.find(
    (definition) => definition.name === "mcp-integration",
  );
  assert.ok(mcpIntegration);
  assert.deepEqual(mcpIntegration.arguments, [
    "--test",
    "test/mcp-http-integration.test.js",
    "test/mcp-security-integration.test.js",
  ]);
});

test("verification metadata reads the exact installed static tool versions", () => {
  const metadata = readVerificationMetadata(repositoryRoot);

  assert.equal(metadata.formatterVersion, "3.7.4");
  assert.equal(metadata.coverageToolVersion, "12.0.0");
  assert.equal(metadata.eslintVersion, "9.39.1");
  assert.equal(metadata.eslintPluginNodeVersion, "18.2.2");
  assert.equal(metadata.jsonSchemaFormatsVersion, "3.0.1");
  assert.equal(metadata.jsonSchemaValidatorVersion, "8.20.0");
  assert.equal(metadata.openApiValidatorVersion, "2.9.0");
  assert.equal(metadata.typeCheckerVersion, "7.0.2");
});

test("static gate definitions reject unavailable tool-version evidence", () => {
  assert.throws(
    () =>
      createGateDefinitions({
        applicationVersion: "1.2.3",
        coverageToolVersion: "12.0.0",
        eslintPluginNodeVersion: "18.2.2",
        eslintVersion: null,
        formatterVersion: "3.7.4",
        jsonSchemaFormatsVersion: "3.0.1",
        jsonSchemaValidatorVersion: "8.20.0",
        openApiValidatorVersion: "2.9.0",
        typeCheckerVersion: "7.0.2",
      }),
    /verification metadata must include an exact eslint version/,
  );
});

test("metadata failure emits its exact manifest without building gates", () => {
  const directory = mkdtempSync(
    resolve(tmpdir(), "quality-bar-metadata-fail-"),
  );
  try {
    const evidencePath = resolve(directory, "evidence.json");
    const result = runVerification({
      repositoryRoot,
      manifestPath: evidencePath,
      metadataReader: () => {
        throw new Error("exact metadata failure");
      },
    });

    assert.equal(result.manifest.outcome, "fail");
    assert.deepEqual(result.manifest.invokedGates, []);
    assert.deepEqual(result.manifest.failures, [
      {
        code: "verification_metadata_failed",
        detail: "exact metadata failure",
      },
    ]);
    assert.match(
      result.report,
      /verification_metadata_failed: exact metadata failure/,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(evidencePath, "utf8")),
      result.manifest,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("static gate evidence records exact tools, duration, and meaningful check counts", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "quality-bar-static-gate-"));
  try {
    const passingCheck = resolve(directory, "passing-check.mjs");
    writeFileSync(
      passingCheck,
      'process.stdout.write("static_check: PASS (4 maintained JavaScript files, zero warnings)\\n");\n',
    );
    const evidencePath = resolve(directory, "evidence.json");
    const result = runVerification({
      repositoryRoot,
      manifestPath: evidencePath,
      gateDefinitions: [
        {
          name: "static-proof",
          failureCode: "static_proof_failed",
          arguments: [passingCheck],
          checkGroups: [
            {
              name: "maintained-javascript",
              countPattern: /PASS \((\d+) maintained JavaScript files,/,
              unit: "file",
            },
          ],
          tools: { eslint: "9.39.1", node: process.version },
        },
      ],
    });

    assert.equal(result.manifest.outcome, "pass");
    assert.deepEqual(result.manifest.invokedGates[0].checkGroups, [
      { name: "maintained-javascript", count: 4, unit: "file" },
    ]);
    assert.deepEqual(result.manifest.invokedGates[0].testGroups, []);
    assert.deepEqual(result.manifest.invokedGates[0].tools, {
      eslint: "9.39.1",
      node: process.version,
    });
    assert.ok(result.manifest.invokedGates[0].durationMs >= 0);
    assert.match(result.report, /static-proof: PASS \(4 files,/);
    assert.match(result.report, /eslint 9\.39\.1/);
    assert.match(result.report, new RegExp(`node ${process.version}`));
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the human summary reports an exact verifier-created evidence failure", () => {
  const directory = mkdtempSync(
    resolve(tmpdir(), "quality-bar-invalid-evidence-"),
  );
  try {
    const incompleteCheck = resolve(directory, "incomplete-check.mjs");
    writeFileSync(
      incompleteCheck,
      'process.stdout.write("check passed\\n");\n',
    );
    const result = runVerification({
      repositoryRoot,
      manifestPath: resolve(directory, "evidence.json"),
      gateDefinitions: [
        {
          name: "static-proof",
          failureCode: "static_proof_failed",
          arguments: [incompleteCheck],
          checkGroups: [
            {
              name: "maintained-javascript",
              countPattern: /PASS \((\d+) maintained JavaScript files,/,
              unit: "file",
            },
          ],
          tools: { eslint: "9.39.1", node: process.version },
        },
      ],
      failureOutputWriter: () => {},
    });

    assert.equal(result.manifest.outcome, "fail");
    assert.match(
      result.report,
      /verification_evidence_invalid: static-proof passed without its required check count/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("each static gate emits its owning hard failure and stops verification", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "quality-bar-static-fail-"));
  try {
    const failingCheck = resolve(directory, "failing-check.mjs");
    const mustNotRun = resolve(directory, "must-not-run.mjs");
    writeFileSync(
      failingCheck,
      'process.stderr.write("exact owning static failure\\n"); process.exit(1);\n',
    );
    writeFileSync(
      mustNotRun,
      'throw new Error("verification did not fail fast");\n',
    );
    const metadata = {
      applicationVersion: "1.2.3",
      coverageToolVersion: "12.0.0",
      eslintPluginNodeVersion: "18.2.2",
      eslintVersion: "9.39.1",
      formatterVersion: "3.7.4",
      jsonSchemaFormatsVersion: "3.0.1",
      jsonSchemaValidatorVersion: "8.20.0",
      openApiValidatorVersion: "2.9.0",
      packagedNodeVersion: "24.18.0",
      runnerGitVersion: "2.51.0",
      sourceCommit: "abc123",
      typeCheckerVersion: "7.0.2",
    };

    for (const definition of createGateDefinitions(metadata).slice(0, 6)) {
      /** @type {string[]} */
      const failureOutput = [];
      const result = runVerification({
        repositoryRoot,
        manifestPath: resolve(directory, `${definition.name}.json`),
        metadataReader: () => metadata,
        failureOutputWriter: (output) => failureOutput.push(output),
        gateDefinitions: [
          {
            ...definition,
            command: undefined,
            arguments: [failingCheck],
          },
          gate("must-not-run", mustNotRun),
        ],
      });

      assert.equal(result.manifest.outcome, "fail");
      assert.deepEqual(
        result.manifest.invokedGates.map((gateEvidence) => gateEvidence.name),
        [definition.name],
      );
      assert.equal(result.manifest.failures[0].code, definition.failureCode);
      assert.match(
        result.manifest.failures[0].detail,
        /exact owning static failure/,
      );
      assert.deepEqual(failureOutput, ["exact owning static failure\n"]);
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
