import { responseMessage } from "../browser.js";

/** @param {(message: string) => void} showError */
export async function consumeGitHubCallbackFailure(showError) {
  const query = new URLSearchParams(location.search);
  const receipt = query.get("github_connection_error");
  if (receipt === null) {
    return false;
  }
  query.delete("github_connection_error");
  history.replaceState(null, "", query.size ? `/?${query}` : "/");
  let response;
  try {
    response = await fetch(
      `/api/v1/github-connections/callback-error?receipt=${encodeURIComponent(receipt)}`,
    );
  } catch {
    showError("GitHub callback error loading failed");
    return true;
  }
  if (!response.ok) {
    showError(
      await responseMessage(response, "GitHub callback error loading failed"),
    );
    return true;
  }
  const failure = await response.json();
  if (failure === null) {
    return false;
  }
  if (
    !failure ||
    typeof failure.code !== "string" ||
    typeof failure.message !== "string"
  ) {
    showError("GitHub callback error response is invalid");
    return true;
  }
  showError(`${failure.message} (${failure.code})`);
  return true;
}
