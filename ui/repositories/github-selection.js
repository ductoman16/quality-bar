import { csrfRequest } from "../browser.js";
import { validGitHubSelection } from "./contract.js";

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
    return { message: "GitHub Repository selection request failed" };
  }
  if (!response.ok) {
    return { response };
  }
  if (response.status !== 201) {
    return { message: "GitHub Repository selection response is invalid" };
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
    };
  }
}
