import { resolve } from "node:path";

import { createGateDefinitions } from "./gate-definitions.mjs";
import { runGate } from "./gate-execution.mjs";
import {
  createManifest,
  formatReport,
  writeManifest,
} from "./manifest-reporting.mjs";
import { readVerificationMetadata } from "./metadata.mjs";

export function runVerification({
  repositoryRoot = resolve(import.meta.dirname, "../.."),
  manifestPath = resolve(
    repositoryRoot,
    process.env.QUALITY_BAR_EVIDENCE_PATH ??
      "artifacts/verification/evidence.json",
  ),
  metadataReader = readVerificationMetadata,
  gateDefinitions,
  failureOutputWriter = (output) => process.stderr.write(output),
} = {}) {
  const startedAt = performance.now();
  const gates = [];
  const failures = [];
  let metadata = {
    applicationVersion: null,
    formatterVersion: null,
    packagedNodeVersion: null,
    runnerGitVersion: null,
    sourceCommit: null,
    typeCheckerVersion: null,
  };

  try {
    metadata = metadataReader(repositoryRoot);
  } catch (error) {
    failures.push({
      code: "verification_metadata_failed",
      detail: error.message,
    });
  }

  const definitions =
    gateDefinitions ?? createGateDefinitions(metadata.applicationVersion);
  if (failures.length === 0) {
    for (const definition of definitions) {
      const result = runGate(repositoryRoot, definition);
      gates.push(result.evidence);
      if (result.failure) {
        failures.push(result.failure);
        if (result.output) {
          failureOutputWriter(`${result.output}\n`);
        }
        break;
      }
    }
  }

  const manifest = createManifest({ metadata, gates, failures, startedAt });
  writeManifest(manifestPath, manifest);
  return { manifest, report: formatReport(manifest, manifestPath) };
}
