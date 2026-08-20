import {
  csrfRequest,
  repositoryCollection,
  responseMessage,
} from "../browser.js";
import {
  reconciledGitHubSelection,
  validGitHubConnection,
  validGitHubSelection,
} from "./contract.js";

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
    return reconcile(selected, requestId);
  }
  if (!response.ok) {
    return { response };
  }
  try {
    if (!validGitHubSelection(await response.json(), selected, requestId)) {
      throw new Error("github_repository_selection_response_invalid");
    }
    return { registered: true };
  } catch {
    return reconcile(selected, requestId);
  }
}

/** @param {number[]} selected @param {string} requestId */
async function reconcile(selected, requestId) {
  try {
    const response = await fetch("/api/v1/github-connections");
    if (!response.ok) {
      throw new Error(await responseMessage(response));
    }
    const connection = await response.json();
    if (!validGitHubConnection(connection)) {
      throw new Error("github_connection_response_invalid");
    }
    const repositories = await repositoryCollection();
    return reconciledGitHubSelection(
      connection,
      repositories,
      selected,
      requestId,
    )
      ? { registered: true }
      : { message: "GitHub Repository selection result is unavailable" };
  } catch {
    return { message: "GitHub Repository selection reconciliation failed" };
  }
}
