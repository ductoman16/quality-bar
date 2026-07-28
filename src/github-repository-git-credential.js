/**
 * @param {any} durableCore
 * @param {{
 *   cipher: {decrypt: (connection: {appId: number, id: string}, encrypted: string) => {client_id: string | null, installation_id: number, pem: string}},
 *   verifier: {createInstallationToken?: (credential: any, installationId: number) => Promise<string>}
 * }} dependencies
 */
export function createGitHubRepositoryGitCredential(
  durableCore,
  { cipher, verifier },
) {
  /** @param {string} connectionId */
  return async function acquireRepositoryGitCredential(connectionId) {
    if (typeof verifier.createInstallationToken !== "function") {
      throw new TypeError(
        "GitHub installation token dependency is unavailable",
      );
    }
    const [connection] = durableCore.all(
      `SELECT
         github_connections.id,
         github_connections.app_id,
         github_connections.app_slug,
         github_connections.installation_id,
         github_connections.principal_id,
         github_connections.principal_login,
         github_connection_credentials.encrypted_credential
       FROM github_connections
       JOIN github_connection_credentials
         ON github_connection_credentials.connection_id =
            github_connections.id
       WHERE github_connections.id = ?`,
      connectionId,
    );
    if (
      !connection ||
      typeof connection.id !== "string" ||
      !Number.isSafeInteger(connection.app_id) ||
      typeof connection.app_slug !== "string" ||
      !Number.isSafeInteger(connection.installation_id) ||
      !Number.isSafeInteger(connection.principal_id) ||
      typeof connection.principal_login !== "string" ||
      typeof connection.encrypted_credential !== "string"
    ) {
      throw new TypeError("GitHub Connection credential row is invalid");
    }
    const encrypted = cipher.decrypt(
      {
        appId: /** @type {number} */ (connection.app_id),
        id: connection.id,
      },
      connection.encrypted_credential,
    );
    const token = await verifier.createInstallationToken(
      {
        app_id: /** @type {number} */ (connection.app_id),
        app_slug: connection.app_slug,
        client_id: encrypted.client_id,
        owner: {
          id: /** @type {number} */ (connection.principal_id),
          login: connection.principal_login,
          type: "User",
        },
        pem: encrypted.pem,
      },
      /** @type {number} */ (connection.installation_id),
    );
    return { token, username: "x-access-token" };
  };
}
