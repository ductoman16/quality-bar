import { csrfRequest } from "../browser.js";
import { validGitHubSelection } from "./contract.js";

export function githubRepositoryChoices(connection) {
  const latest = connection?.verification_history?.at(-1);
  return latest?.repositories.length
    ? latest.repositories
    : (latest?.affected_repository_ids ?? []).map((id) => ({
        full_name: `Forge Repository ${id}`,
        id,
        verification_required: true,
      }));
}

/** @param {string} csrfCookieName @param {number[]} selected */
export async function registerGitHubSelection(csrfCookieName, selected) {
  const requestId = crypto.randomUUID();
  let response;
  try {
    response = await csrfRequest(
      csrfCookieName,
      "/api/v1/github-connections/repositories",
      { repository_ids: selected, request_id: requestId },
    );
  } catch {
    return {
      message: "GitHub Repository selection request failed",
      requestId,
    };
  }
  if (!response.ok) {
    return { response };
  }
  if (response.status !== 201) {
    return {
      message: "GitHub Repository selection response is invalid",
      requestId,
    };
  }
  try {
    if (!validGitHubSelection(await response.json(), selected, requestId)) {
      throw new Error("github_repository_selection_response_invalid");
    }
    return { registered: true };
  } catch (failure) {
    return {
      message:
        failure instanceof Error
          ? failure.message
          : "GitHub Repository selection response is invalid",
      requestId,
    };
  }
}

/** @param {any} connection @param {any[]} repositories @param {number[]} selected @param {string} requestId */
export function reconciledGitHubSelection(
  connection,
  repositories,
  selected,
  requestId,
) {
  const verification = connection?.verification_history.find(
    ({ id }) => id === requestId,
  );
  return (
    verification?.trigger === "repository_selection" &&
    verification.outcome === "success" &&
    selected.every((id) => verification.affected_repository_ids.includes(id)) &&
    selected.every((id) =>
      repositories.some(
        (repository) =>
          repository.provider === "github" &&
          repository.forge_repository_id === id &&
          repository.verification_id === verification.id,
      ),
    )
  );
}
