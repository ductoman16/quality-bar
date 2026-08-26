import { GitHubConnectionError } from "./github-connection-error.ts";

export function validGitHubRepositoryEvidence(
  repository: any,
  principalLogin: string,
) {
  return (
    repository &&
    Number.isSafeInteger(repository.id) &&
    repository.id > 0 &&
    typeof repository.full_name === "string" &&
    repository.full_name.split("/")[1]?.length > 0 &&
    repository.full_name ===
      `${principalLogin}/${repository.full_name.split("/")[1] ?? ""}` &&
    repository.clone_url === `https://github.com/${repository.full_name}.git` &&
    repository.api_url ===
      `https://api.github.com/repos/${repository.full_name}` &&
    repository.html_url === `https://github.com/${repository.full_name}` &&
    typeof repository.private === "boolean"
  );
}

export function verifiedGitHubRepositoryEvidence(
  error: GitHubConnectionError,
  principalLogin: string,
) {
  const evidence = error.repositoryEvidence ?? [];
  if (
    error.repositoryEvidence &&
    (evidence.length === 0 ||
      evidence.some(
        (repository: any) =>
          !validGitHubRepositoryEvidence(repository, principalLogin),
      ))
  ) {
    throw new TypeError("GitHub Repository failure evidence is invalid");
  }
  return evidence;
}

export function failGitHubRepositoryVerification(
  code: string,
  message: string,
  affectedRepositoryIds: number[] | undefined,
  repositoryEvidence: unknown[],
  repositoryId?: number | undefined,
): never {
  throw new GitHubConnectionError(code, message, {
    affectedRepositoryIds,
    repositoryEvidence,
    repositoryId,
  });
}
