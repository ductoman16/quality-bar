import { GitHubConnectionError } from "./github-connection-error.js";

/** @param {any} repository @param {string} principalLogin */
export function validGitHubRepositoryEvidence(repository, principalLogin) {
  return (
    repository &&
    Number.isSafeInteger(repository.id) &&
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

/** @param {GitHubConnectionError} error @param {string} principalLogin */
export function verifiedGitHubRepositoryEvidence(error, principalLogin) {
  const evidence = error.repositoryEvidence ?? [];
  if (
    error.repositoryEvidence &&
    (evidence.length === 0 ||
      evidence.some(
        (repository) =>
          !validGitHubRepositoryEvidence(repository, principalLogin),
      ))
  ) {
    throw new TypeError("GitHub Repository failure evidence is invalid");
  }
  return evidence;
}

/** @param {string} code @param {string} message @param {number[] | undefined} affectedRepositoryIds @param {unknown[]} repositoryEvidence @param {number | undefined} [repositoryId] @returns {never} */
export function failGitHubRepositoryVerification(
  code,
  message,
  affectedRepositoryIds,
  repositoryEvidence,
  repositoryId,
) {
  throw new GitHubConnectionError(code, message, {
    affectedRepositoryIds,
    repositoryEvidence,
    repositoryId,
  });
}
