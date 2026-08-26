import { GitHubConnectionError } from "./github-connection-error.ts";

const FLOW_LIFETIME_MS = 60 * 60 * 1_000;

export function createGitHubConnectionFlowToken(
  randomBytes: (size: number) => Buffer,
) {
  return function transientToken() {
    const value = randomBytes(32).toString("base64url");
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(value)) {
      throw new TypeError("randomBytes must return usable entropy");
    }
    return value;
  };
}

export function createGitHubConnectionTimestamp(now: () => number) {
  return function timestamp() {
    const value = now();
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("now must return a safe integer timestamp");
    }
    return value;
  };
}

export function takeGitHubConnectionFlow(
  {
    pending,
    timestamp,
  }: { pending: Map<string, any>; timestamp: () => number },
  state: string,
  stage: "manifest" | "installation",
) {
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
