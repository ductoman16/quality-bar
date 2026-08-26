import { createGitHubAppManifest } from "./github-app-manifest.ts";
import { GitHubConnectionError } from "./github-connection-error.ts";

export function startGitHubConnection({
  durableCore,
  externalOrigin,
  pending,
  timestamp,
  transientToken,
}: {
  durableCore: { all: (sql: string) => any[] };
  externalOrigin: string;
  pending: Map<string, any>;
  timestamp: () => number;
  transientToken: () => string;
}) {
  const [connection] = durableCore.all(
    "SELECT lifecycle FROM github_connections LIMIT 1",
  );
  if (connection) {
    throw new GitHubConnectionError(
      "github_connection_conflict",
      connection.lifecycle === "retired"
        ? "A retired GitHub Connection must be reactivated with a replacement private key"
        : "A GitHub Connection is already configured",
    );
  }
  const state = transientToken();
  pending.set(state, { createdAt: timestamp(), stage: "manifest" });
  return {
    action: `https://github.com/settings/apps/new?state=${encodeURIComponent(
      state,
    )}`,
    manifest: createGitHubAppManifest({ externalOrigin, state }),
    method: "POST",
    state,
  };
}
