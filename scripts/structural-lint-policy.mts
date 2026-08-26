export const GENERATED_ARTIFACT_ALLOWLIST = [
  "artifacts/verification/**",
  "dist/**",
];

export function isGeneratedArtifact(path: string) {
  return (
    path === "dist" ||
    path.startsWith("dist/") ||
    path === "artifacts/verification" ||
    path.startsWith("artifacts/verification/")
  );
}
