import { resolve } from "node:path";

import {
  collectVerificationEvidence,
  runVerification as coreRunVerification,
} from "./verification-runner.mjs";

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
  manifestPath,
  ...options
} = {}) {
  return coreRunVerification({
    repositoryRoot,
    manifestPath:
      manifestPath ??
      resolve(
        repositoryRoot,
        process.env.QUALITY_BAR_EVIDENCE_PATH ??
          "artifacts/verification/evidence.json",
      ),
    ...options,
  });
}

export { collectVerificationEvidence };
