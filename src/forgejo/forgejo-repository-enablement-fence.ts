function conflict(message: string): never {
  throw Object.assign(new Error(message), {
    code: "forgejo_repository_enablement_conflict",
  });
}

export function requireCurrentForgejoConnection(
  transaction: any,
  connection: any,
) {
  const current = transaction.get(
    `SELECT forgejo_connections.lifecycle,
            forgejo_connections.health,
            forgejo_connections.verified_at,
            (
              SELECT id FROM forgejo_connection_verifications
               WHERE connection_id = forgejo_connections.id
               ORDER BY rowid DESC LIMIT 1
            ) AS latest_verification_id,
            forgejo_connection_credentials.encrypted_credential
       FROM forgejo_connections
       LEFT JOIN forgejo_connection_credentials
         ON forgejo_connection_credentials.connection_id =
            forgejo_connections.id
      WHERE forgejo_connections.id = ?`,
    connection.id,
  );
  if (
    current?.lifecycle !== "enabled" ||
    current.health !== connection.health ||
    current.verified_at !== connection.verified_at ||
    current.latest_verification_id !== connection.latest_verification_id ||
    current.encrypted_credential !== connection.encrypted_credential
  ) {
    conflict("Forgejo Connection changed during Repository enablement");
  }
}

export function requireCurrentForgejoRepositories(
  transaction: any,
  connectionId: string,
  repositories: any[],
) {
  for (const repository of repositories) {
    const current = transaction.get(
      `SELECT repositories.lifecycle, repositories.lifecycle_revision,
              repositories.health, repositories.health_error_code,
              repositories.health_error_message, repositories.verified_at,
              forgejo_repositories.verification_id
       FROM repositories
       JOIN forgejo_repositories
         ON forgejo_repositories.repository_id = repositories.id
       WHERE forgejo_repositories.connection_id = ?
         AND forgejo_repositories.forge_repository_id = ?`,
      connectionId,
      repository.id,
    );
    if (
      current?.lifecycle !== repository.lifecycle ||
      current.lifecycle_revision !== repository.lifecycle_revision ||
      current.health !== repository.health ||
      current.health_error_code !== repository.health_error_code ||
      current.health_error_message !== repository.health_error_message ||
      current.verified_at !== repository.verified_at ||
      current.verification_id !== repository.verification_id
    ) {
      conflict("Forgejo Repository changed during enablement");
    }
  }
}

export function requireCurrentForgejoPollingGeneration(
  transaction: any,
  connectionId: string,
  expectedGeneration: number,
) {
  if (
    readForgejoPollingGeneration(transaction, connectionId) !==
    expectedGeneration
  ) {
    conflict("Forgejo polling changed during Repository enablement");
  }
}
import { readForgejoPollingGeneration } from "./forgejo-polling.ts";
