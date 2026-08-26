export function createGitHubRepositoryGitCredential(
  durableCore: any,
  {
    cipher,
    verifier,
  }: {
    cipher: {
      decrypt: (
        connection: { appId: number; id: string },
        encrypted: string,
      ) => { client_id: string | null; installation_id: number; pem: string };
    };
    verifier: {
      createInstallationToken?: (
        credential: any,
        installationId: number,
      ) => Promise<string>;
    };
  },
) {
  return async function acquireRepositoryGitCredential(connectionId: string) {
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
        appId: connection.app_id as number,
        id: connection.id,
      },
      connection.encrypted_credential,
    );
    const token = await verifier.createInstallationToken(
      {
        app_id: connection.app_id as number,
        app_slug: connection.app_slug,
        client_id: encrypted.client_id,
        owner: {
          id: connection.principal_id as number,
          login: connection.principal_login,
          type: "User",
        },
        pem: encrypted.pem,
      },
      connection.installation_id as number,
    );
    return { token, username: "x-access-token" };
  };
}
