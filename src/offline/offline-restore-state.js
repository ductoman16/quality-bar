import { createForgejoConnectionCredentialCipher } from "../forgejo/forgejo-connection-credential.js";
import { createGitHubConnectionCredentialCipher } from "../github/github-connection-credential.js";
import { failRestore } from "./offline-restore-error.js";
import { createRepositoryCredentialCipher } from "../repository/repository-credential.js";

/**
 * @param {ReturnType<typeof import("../durable/durable-core.js").openDurableCore>} core
 * @param {Buffer} masterKey
 */
export function validateRestoredCredentials(core, masterKey) {
  const githubCipher = createGitHubConnectionCredentialCipher(masterKey);
  const forgejoCipher = createForgejoConnectionCredentialCipher(masterKey);
  const repositoryCipher = createRepositoryCredentialCipher(masterKey);
  try {
    for (const row of /** @type {any[]} */ (
      core.all(
        `SELECT github_connections.id, github_connections.app_id,
              github_connections.lifecycle,
              github_connection_credentials.encrypted_credential
         FROM github_connections
         LEFT JOIN github_connection_credentials
           ON github_connection_credentials.connection_id = github_connections.id`,
      )
    )) {
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
        /** @type {string} */ (row.encrypted_credential),
      );
    }
    for (const row of /** @type {any[]} */ (
      core.all(
        `SELECT forgejo_connections.id, forgejo_connections.lifecycle,
              forgejo_connection_credentials.encrypted_credential
         FROM forgejo_connections
         LEFT JOIN forgejo_connection_credentials
           ON forgejo_connection_credentials.connection_id = forgejo_connections.id`,
      )
    )) {
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
        /** @type {string} */ (row.id),
        /** @type {string} */ (row.encrypted_credential),
      );
    }
    for (const row of /** @type {any[]} */ (
      core.all(
        `SELECT repositories.id, repositories.normalized_url,
              repository_credentials.encrypted_credential
         FROM repositories
         JOIN repository_credentials
           ON repository_credentials.repository_id = repositories.id`,
      )
    )) {
      repositoryCipher.decrypt(
        {
          id: /** @type {string} */ (row.id),
          url: /** @type {string} */ (row.normalized_url),
        },
        /** @type {string} */ (row.encrypted_credential),
      );
    }
  } finally {
    githubCipher.destroy();
    forgejoCipher.destroy();
    repositoryCipher.destroy();
  }
}
