import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";

import { validateCostFreeEvidence } from "../scripts/verification/cost-free-evidence-validation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();

test("rejects a handcrafted partial pass before provider spend", () => {
  assert.throws(
    () =>
      validateCostFreeEvidence(
        {
          evidenceVersion: 1,
          failures: [],
          outcome: "pass",
          sourceCommit,
          verification: { kind: "cost-free" },
        },
        { repositoryRoot, sourceCommit },
      ),
    /cost-free verification evidence is incomplete/u,
  );
});

test("rejects a complete-looking manifest with no invoked gate proof", () => {
  assert.throws(
    () =>
      validateCostFreeEvidence(
        {
          applicationCoverage: {},
          componentVersions: {},
          evidenceVersion: 1,
          failures: [],
          invokedGates: [],
          outcome: "pass",
          performance: {},
          platform: {},
          releaseCanaries: null,
          runnerVersions: {},
          securityBoundary: {},
          sourceCommit,
          totalDurationMs: 1,
          verification: { kind: "cost-free" },
        },
        { repositoryRoot, sourceCommit },
      ),
    /cost-free verification gate evidence is incomplete/u,
  );
});
