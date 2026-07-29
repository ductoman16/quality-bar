import { GitHubConnectionError } from "./github-connection-error.js";

const FLOW_LIFETIME_MS = 60 * 60 * 1_000;

/** @param {(size: number) => Buffer} randomBytes */
export function createGitHubConnectionFlowToken(randomBytes) {
  return function transientToken() {
    const value = randomBytes(32).toString("base64url");
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(value)) {
      throw new TypeError("randomBytes must return usable entropy");
    }
    return value;
  };
}

/** @param {() => number} now */
export function createGitHubConnectionTimestamp(now) {
  return function timestamp() {
    const value = now();
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("now must return a safe integer timestamp");
    }
    return value;
  };
}

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
