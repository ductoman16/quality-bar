import { createForgejoConnectionCredentialCipher } from "../forgejo/forgejo-connection-credential.ts";
import { createGitHubConnectionCredentialCipher } from "../github/github-connection-credential.ts";
import { failRestore } from "./offline-restore-error.ts";
import { createRepositoryCredentialCipher } from "../repository/repository-credential.ts";

export function validateRestoredCredentials(
  core: ReturnType<typeof import("../durable/durable-core.ts").openDurableCore>,
  masterKey: Buffer,
) {
  const githubCipher = createGitHubConnectionCredentialCipher(masterKey);
  const forgejoCipher = createForgejoConnectionCredentialCipher(masterKey);
  const repositoryCipher = createRepositoryCredentialCipher(masterKey);
  try {
    for (const row of core.all(
      `SELECT github_connections.id, github_connections.app_id,
              github_connections.lifecycle,
              github_connection_credentials.encrypted_credential
         FROM github_connections
         LEFT JOIN github_connection_credentials
           ON github_connection_credentials.connection_id = github_connections.id`,
    ) as any[]) {
      if (row.encrypted_credential === null) {
        if (row.lifecycle === "retired") {
          continue;
        }
        failRestore(
          "github_connection_credential_missing",
          "Enabled GitHub Connection credential is missing",
        );
      }
      githubCipher.decrypt(
        { appId: row.app_id, id: row.id },
        row.encrypted_credential as string,
      );
    }
    for (const row of core.all(
      `SELECT forgejo_connections.id, forgejo_connections.lifecycle,
              forgejo_connection_credentials.encrypted_credential
         FROM forgejo_connections
         LEFT JOIN forgejo_connection_credentials
           ON forgejo_connection_credentials.connection_id = forgejo_connections.id`,
    ) as any[]) {
      if (row.encrypted_credential === null) {
        if (row.lifecycle === "retired") {
          continue;
        }
        failRestore(
          "forgejo_connection_credential_missing",
          "Enabled Forgejo Connection credential is missing",
        );
      }
      forgejoCipher.decrypt(
        row.id as string,
        row.encrypted_credential as string,
      );
    }
    for (const row of core.all(
      `SELECT repositories.id, repositories.normalized_url,
              repository_credentials.encrypted_credential
         FROM repositories
         JOIN repository_credentials
           ON repository_credentials.repository_id = repositories.id`,
    ) as any[]) {
      repositoryCipher.decrypt(
        {
          id: row.id as string,
          url: row.normalized_url as string,
        },
        row.encrypted_credential as string,
      );
    }
  } finally {
    githubCipher.destroy();
    forgejoCipher.destroy();
    repositoryCipher.destroy();
  }
}
