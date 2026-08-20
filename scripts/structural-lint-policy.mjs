export const GENERATED_ARTIFACT_ALLOWLIST = [
  "artifacts/verification/**",
  "dist/**",
];

/** @param {string} path */
export function isGeneratedArtifact(path) {
  return (
    path === "dist" ||
    path.startsWith("dist/") ||
    path === "artifacts/verification" ||
    path.startsWith("artifacts/verification/")
  );
}
