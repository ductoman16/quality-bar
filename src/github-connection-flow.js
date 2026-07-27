import { GitHubConnectionError } from "./github-connection-error.js";

const FLOW_LIFETIME_MS = 60 * 60 * 1_000;

/**
 * @param {{pending: Map<string, any>, timestamp: () => number}} dependencies
 * @param {string} state
 * @param {"manifest" | "installation"} stage
 */
export function takeGitHubConnectionFlow({ pending, timestamp }, state, stage) {
  const flow = pending.get(state);
  pending.delete(state);
  if (
    !flow ||
    flow.stage !== stage ||
    timestamp() - flow.createdAt > FLOW_LIFETIME_MS
  ) {
    throw new GitHubConnectionError(
      "github_manifest_state_invalid",
      "GitHub App Manifest state is invalid or expired",
    );
  }
  return flow;
}
