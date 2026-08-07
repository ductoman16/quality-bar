import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateCostFreeEvidence } from "./verification/cost-free-evidence-validation.mjs";
import { auditTraceability } from "./verification/traceability-audit.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(
  repositoryRoot,
  "artifacts/verification/evidence.json",
);

try {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest) ||
    typeof manifest.sourceCommit !== "string"
  ) {
    throw new TypeError("release acceptance manifest identity is invalid");
  }
  validateCostFreeEvidence(manifest, {
    repositoryRoot,
    sourceCommit: manifest.sourceCommit,
  });
  auditTraceability({
    repositoryRoot,
    releaseCanaries: manifest.releaseCanaries,
    sourceCommit: manifest.sourceCommit,
  });
  process.stdout.write("Quality Bar release acceptance: PASS\n");
} catch (error) {
  process.stderr.write(
    `Quality Bar release acceptance: FAIL\n- ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exitCode = 1;
}
