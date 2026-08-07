import {
  updateReleaseCanaryEvidence,
  writeDurableJson,
} from "./release-canary-evidence.mjs";

/**
 * Publish the standalone record while the manifest lease fences readers,
 * then commit the canonical manifest before releasing that lease.
 *
 * @param {{
 *   canary: any,
 *   canaryPath: string,
 *   manifestPath: string,
 *   mergeEvidence: (manifest: any, canary: any) => any,
 *   updateEvidence?: typeof updateReleaseCanaryEvidence,
 *   writeEvidence?: (path: string, value: unknown) => unknown,
 * }} input
 */
export function publishReleaseCanaryAttempt({
  canary,
  canaryPath,
  manifestPath,
  mergeEvidence,
  updateEvidence = updateReleaseCanaryEvidence,
  writeEvidence = writeDurableJson,
}) {
  try {
    updateEvidence({
      beforeUpdate: () => writeEvidence(canaryPath, canary),
      canary,
      manifestPath,
      mergeEvidence,
    });
  } catch (error) {
    throw error instanceof Error
      ? error
      : new TypeError("release canary publication failed", { cause: error });
  }
}
