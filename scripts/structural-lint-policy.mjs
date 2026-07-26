export const GENERATED_ARTIFACT_ALLOWLIST = ["artifacts/verification/**"];

/** @param {string} path */
export function isGeneratedArtifact(path) {
  return (
    path === "artifacts/verification" ||
    path.startsWith("artifacts/verification/")
  );
}
