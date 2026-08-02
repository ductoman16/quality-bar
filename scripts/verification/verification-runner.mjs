import { resolve } from "node:path";

import { createGateDefinitions } from "./gate-definitions.mjs";
import { runCommand } from "./command-executor.mjs";
import { runGate } from "./gate-execution.mjs";
import {
  createVerificationAggregation,
  readVerificationOwnership,
} from "./verification-aggregation.mjs";
import {
  createManifest,
  formatReport,
  writeManifest,
} from "./manifest-reporting.mjs";
import { readVerificationMetadata } from "./metadata.mjs";

/**
 * @param {{
 *   repositoryRoot?: string,
 *   metadataReader?: (repositoryRoot: string) => import("./manifest-reporting.mjs").VerificationMetadata,
 *   gateDefinitions?: import("./gate-definitions.mjs").GateDefinition[],
 *   commandExecutor?: import("./command-executor.mjs").CommandExecutor,
 *   gateRunner?: (repositoryRoot: string, definition: import("./gate-definitions.mjs").GateDefinition, options?: {
 *     commandExecutor?: import("./command-executor.mjs").CommandExecutor,
 *   }) => {
 *     evidence: import("./manifest-reporting.mjs").VerificationGate,
 *     failure: import("./manifest-reporting.mjs").VerificationFailure | undefined,
 *     output: string | undefined,
 *   },
 *   failureOutputWriter?: (output: string) => unknown,
 * }} [options]
 */
export function collectVerificationEvidence({
  repositoryRoot = resolve(import.meta.dirname, "../.."),
  metadataReader = readVerificationMetadata,
  gateDefinitions,
  commandExecutor = runCommand,
  gateRunner = runGate,
  failureOutputWriter = (output) => process.stderr.write(output),
} = {}) {
  const startedAt = performance.now();
  /** @type {import("./manifest-reporting.mjs").VerificationGate[]} */
  const gates = [];
  /** @type {import("./manifest-reporting.mjs").VerificationFailure[]} */
  const failures = [];
  let verificationAggregation = null;
  /** @type {import("./manifest-reporting.mjs").VerificationMetadata} */
  let metadata = {
    applicationVersion: null,
    coverageToolVersion: null,
    eslintPluginNodeVersion: null,
    eslintVersion: null,
    formatterVersion: null,
    jsonSchemaFormatsVersion: null,
    jsonSchemaValidatorVersion: null,
    openApiValidatorVersion: null,
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

  if (failures.length === 0) {
    let definitions = gateDefinitions;
    if (!definitions) {
      try {
        const ownership = readVerificationOwnership(repositoryRoot);
        definitions = createGateDefinitions(metadata);
        verificationAggregation = createVerificationAggregation({
          definitions,
          ownership,
        });
      } catch (error) {
        failures.push({
          code: "verification_aggregation_failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (failures.length === 0 && definitions) {
      for (const definition of definitions) {
        const result = gateRunner(repositoryRoot, definition, {
          commandExecutor,
        });
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
  }

  return {
    manifest: createManifest({
      metadata,
      gates,
      failures,
      startedAt,
      verificationAggregation,
    }),
    gates,
    failures,
  };
}

/**
 * @param {{
 *   repositoryRoot?: string,
 *   manifestPath?: string,
 *   metadataReader?: (repositoryRoot: string) => import("./manifest-reporting.mjs").VerificationMetadata,
 *   gateDefinitions?: import("./gate-definitions.mjs").GateDefinition[],
 *   commandExecutor?: import("./command-executor.mjs").CommandExecutor,
 *   gateRunner?: (repositoryRoot: string, definition: import("./gate-definitions.mjs").GateDefinition, options?: {
 *     commandExecutor?: import("./command-executor.mjs").CommandExecutor,
 *   }) => {
 *     evidence: import("./manifest-reporting.mjs").VerificationGate,
 *     failure: import("./manifest-reporting.mjs").VerificationFailure | undefined,
 *     output: string | undefined,
 *   },
 *   manifestWriter?: (manifestPath: string, manifest: import("./manifest-reporting.mjs").VerificationManifest) => unknown,
 *   failureOutputWriter?: (output: string) => unknown,
 * }} [options]
 */
export function runVerification({
  repositoryRoot = resolve(import.meta.dirname, "../.."),
  manifestPath = resolve(
    repositoryRoot,
    "artifacts/verification/evidence.json",
  ),
  metadataReader = readVerificationMetadata,
  gateDefinitions,
  commandExecutor = runCommand,
  gateRunner = runGate,
  manifestWriter = writeManifest,
  failureOutputWriter = (output) => process.stderr.write(output),
} = {}) {
  const { manifest } = collectVerificationEvidence({
    repositoryRoot,
    metadataReader,
    gateDefinitions,
    commandExecutor,
    gateRunner,
    failureOutputWriter,
  });

  manifestWriter(manifestPath, manifest);
  return { manifest, report: formatReport(manifest, manifestPath) };
}
