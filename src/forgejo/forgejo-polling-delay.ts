import { FORGEJO_POLL_INTERVAL_MS } from "./forgejo-polling.ts";

export function nextForgejoPollingDelay(
  durableCore: { all: Function },
  timestamp: () => number,
) {
  const [next] = durableCore.all(
    `SELECT MIN(forgejo_repository_polls.next_attempt_at) AS due_at
       FROM forgejo_repository_polls
       JOIN forgejo_connections
         ON forgejo_connections.id = forgejo_repository_polls.connection_id
       JOIN forgejo_repositories
         ON forgejo_repositories.connection_id = forgejo_repository_polls.connection_id
        AND forgejo_repositories.forge_repository_id =
            forgejo_repository_polls.forge_repository_id
       JOIN repositories
         ON repositories.id = forgejo_repositories.repository_id
      WHERE forgejo_connections.lifecycle = 'enabled'
        AND forgejo_connections.health = 'healthy'
        AND repositories.lifecycle = 'enabled'
        AND repositories.health = 'healthy'`,
  );
  return Number.isSafeInteger(next?.due_at)
    ? Math.max(0, Number(next.due_at) - timestamp())
    : FORGEJO_POLL_INTERVAL_MS;
}
