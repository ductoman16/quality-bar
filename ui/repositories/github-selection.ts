import { csrfRequest, requireStatus, responseMessage } from "../browser.ts";
import { validGitHubSelection, validManifestContinuation } from "./contract.ts";

export async function requestGitHubManifest(csrfCookieName: any) {
  const response = await csrfRequest(
    csrfCookieName,
    "/api/v1/github-connections/manifest",
    {},
  );
  await requireStatus(response, 200, "github_manifest_response_invalid");
  const body = await response.json();
  if (!validManifestContinuation(body)) {
    throw new Error("GitHub App Manifest response is invalid");
  }
  return body;
}

export function githubRepositoryChoices(connection: any) {
  const latest = connection?.verification_history?.at(-1);
  return latest?.repositories.length
    ? latest.repositories
    : (latest?.affected_repository_ids ?? []).map((id: any) => ({
        full_name: `Forge Repository ${id}`,
        id,
        verification_required: true,
      }));
}

export async function registerGitHubSelection(
  csrfCookieName: string,
  selected: number[],
) {
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
      ambiguous: true,
      message: "GitHub Repository selection request failed",
      requestId,
    };
  }
  if (!response.ok) {
    try {
      return { ambiguous: false, message: await responseMessage(response) };
    } catch (failure) {
      return {
        ambiguous: false,
        message:
          failure instanceof Error ? failure.message : "error_response_invalid",
      };
    }
  }
  if (response.status !== 201) {
    return {
      ambiguous: true,
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
      ambiguous: true,
      message:
        failure instanceof Error
          ? failure.message
          : "GitHub Repository selection response is invalid",
      requestId,
    };
  }
}

export function reconciledGitHubSelection(
  connection: any,
  repositories: any[],
  selected: number[],
  requestId: string,
) {
  const verification = connection?.verification_history.find(
    ({ id }: any) => id === requestId,
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
