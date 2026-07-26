export const GENERATED_ARTIFACT_ALLOWLIST = ["artifacts/verification/**"];

export function isGeneratedArtifact(path) {
  return (
    path === "artifacts/verification" ||
    path.startsWith("artifacts/verification/")
  );
}
