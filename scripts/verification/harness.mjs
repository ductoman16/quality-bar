import { resolve } from "node:path";

import { createGateDefinitions } from "./gate-definitions.mjs";
import { runGate } from "./gate-execution.mjs";
import {
  createManifest,
  formatReport,
  writeManifest,
} from "./manifest-reporting.mjs";
import { readVerificationMetadata } from "./metadata.mjs";

/**
 * @param {{
 *   repositoryRoot?: string,
 *   manifestPath?: string,
 *   metadataReader?: (repositoryRoot: string) => import("./manifest-reporting.mjs").VerificationMetadata,
 *   gateDefinitions?: import("./gate-definitions.mjs").GateDefinition[],
 *   failureOutputWriter?: (output: string) => unknown,
 * }} [options]
 */
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
  /** @type {import("./manifest-reporting.mjs").VerificationGate[]} */
  const gates = [];
  /** @type {import("./manifest-reporting.mjs").VerificationFailure[]} */
  const failures = [];
  /** @type {import("./manifest-reporting.mjs").VerificationMetadata} */
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
      detail: error instanceof Error ? error.message : String(error),
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
