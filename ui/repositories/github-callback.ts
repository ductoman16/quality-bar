import { responseMessage } from "../browser.ts";
import { exact, nonempty, record } from "../contract.ts";

export async function consumeGitHubCallbackFailure(
  showError: (message: string) => void,
) {
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
    showError(await responseMessage(response));
    return true;
  }
  if (response.status !== 200) {
    showError("GitHub callback error response is invalid");
    return true;
  }
  let failure;
  try {
    failure = await response.json();
  } catch {
    showError("GitHub callback error response is invalid");
    return true;
  }
  if (failure === null) {
    return false;
  }
  if (
    !record(failure) ||
    !exact(failure, ["code", "message"]) ||
    !nonempty(failure.code) ||
    !nonempty(failure.message)
  ) {
    showError("GitHub callback error response is invalid");
    return true;
  }
  showError(`${failure.message} (${failure.code})`);
  return true;
}
