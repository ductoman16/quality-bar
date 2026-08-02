import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { createGateDefinitions } from "../scripts/verification/gate-definitions.mjs";
import {
  createVerificationAggregation,
  readVerificationOwnership,
} from "../scripts/verification/verification-aggregation.mjs";
import { createManifest } from "../scripts/verification/manifest-reporting.mjs";
import { runVerification } from "../scripts/verification/verification-runner.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

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
  sourceCommit: "a".repeat(40),
  typeCheckerVersion: "7.0.2",
};

function definitions() {
  return createGateDefinitions(metadata);
}

test("cost-free verification owns the three accepted invocation groups", () => {
  const ownership = readVerificationOwnership(repositoryRoot);
  const aggregation = createVerificationAggregation({
    definitions: definitions(),
    ownership,
  });

  assert.deepEqual(aggregation.groups.local, [
    "formatting",
    "structural-lint",
    "correctness-lint",
    "node-ownership-lint",
    "production-type-check",
    "proof-code-type-check",
    "unit",
    "browser-component",
  ]);
  assert.deepEqual(
    aggregation.groups["linux-amd64-ci"],
    definitions().map((definition) => definition.name),
  );
  assert.deepEqual(
    aggregation.groups["pre-push"],
    definitions()
      .filter(
        (definition) =>
          !["operator-browser-smoke", "package-integration"].includes(
            definition.name,
          ),
      )
      .map((definition) => definition.name),
  );
  assert.deepEqual(aggregation.crossProcessSmokes, [
    {
      gate: "operator-browser-smoke",
      testGroup: "authenticated-firefox-browser-cross-process",
    },
    { gate: "package-integration", testGroup: "compose-service" },
  ]);
});

test("the shared manifest preserves ownership and aggregation evidence", () => {
  const ownership = readVerificationOwnership(repositoryRoot);
  const aggregation = createVerificationAggregation({
    definitions: definitions(),
    ownership,
  });
  const manifest = createManifest({
    metadata,
    gates: [],
    failures: [],
    startedAt: performance.now(),
    verificationAggregation: aggregation,
  });

  assert.deepEqual(manifest.verification, {
    kind: "cost-free",
    ownership: {
      marker: "evidence/quality-foundation/issue-123-verification.json",
      parent: 25,
      sources: ["#21", "#22"],
      acceptanceScenarios: [
        "ACC-01",
        "ACC-02",
        "ACC-03",
        "ACC-04",
        "ACC-05",
        "ACC-06",
        "ACC-07",
        "ACC-08",
        "ACC-09",
        "ACC-10",
      ],
      proof: ["verification-gate", "evidence-manifest"],
    },
    groups: aggregation.groups,
    crossProcessSmokes: aggregation.crossProcessSmokes,
  });
});

test("the canonical runner invokes every aggregated gate exactly once", () => {
  const result = runVerification({
    repositoryRoot,
    metadataReader: () => metadata,
    gateRunner: (root, definition) => {
      assert.equal(root, repositoryRoot);
      return {
        evidence: {
          name: definition.name,
          command: `node ${definition.name}`,
          testGroups: definition.testGroup
            ? [{ name: definition.testGroup, count: 1 }]
            : [],
          checkGroups: (definition.checkGroups ?? []).map((group) => ({
            name: group.name,
            count: group.count ?? 1,
            unit: group.unit,
          })),
          tools: definition.tools ?? { node: process.version },
          durationMs: 1,
          outcome: "pass",
        },
        failure: undefined,
        output: undefined,
      };
    },
    manifestWriter: () => {},
  });

  assert.equal(result.manifest.outcome, "pass");
  assert.equal(result.manifest.invokedGates.length, definitions().length);
  assert.deepEqual(
    result.manifest.verification?.groups["linux-amd64-ci"],
    definitions().map((definition) => definition.name),
  );
});

test("an unavailable ownership marker is a hard manifest failure", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "quality-bar-ownership-"));
  try {
    /** @type {{path: string, manifest: object} | undefined} */
    let persistedManifest;
    const result = runVerification({
      repositoryRoot: directory,
      metadataReader: () => metadata,
      manifestWriter: (path, manifest) => {
        persistedManifest = { path, manifest };
      },
    });

    assert.equal(result.manifest.outcome, "fail");
    assert.deepEqual(result.manifest.invokedGates, []);
    assert.equal(
      result.manifest.failures[0].code,
      "verification_aggregation_failed",
    );
    assert.match(
      result.manifest.failures[0].detail,
      /^verification_ownership_marker_unavailable:/u,
    );
    assert.ok(persistedManifest);
    assert.match(persistedManifest.path, /evidence\.json$/u);
    assert.equal(persistedManifest.manifest, result.manifest);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("aggregation rejects a registry that loses a fixed cross-process smoke", () => {
  const ownership = readVerificationOwnership(repositoryRoot);
  assert.throws(
    () =>
      createVerificationAggregation({
        definitions: definitions().filter(
          (definition) => definition.name !== "package-integration",
        ),
        ownership,
      }),
    /verification_aggregation_cross_process_smoke_invalid/,
  );
});
