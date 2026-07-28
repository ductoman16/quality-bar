import { verifiedForgejoRepositories } from "./forgejo-connection-rotation.js";

/** @param {string} code @param {string} message @returns {never} */
function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

/**
 * @param {{all: Function}} durableCore
 * @param {{decrypt: (id: string, encrypted: string) => string}} cipher
 * @param {{verify: (input: any) => Promise<any>}} verifier
 * @param {{commitBaseline: Function, prepareBaseline: Function}} polling
 * @param {number} forgeRepositoryId
 */
export async function prepareForgejoRepositoryEnablement(
  durableCore,
  cipher,
  verifier,
  polling,
  forgeRepositoryId,
) {
  if (!Number.isSafeInteger(forgeRepositoryId) || forgeRepositoryId <= 0) {
    throw new TypeError("Forgejo Repository identity is invalid");
  }
  const [connection] = durableCore.all(
    `SELECT forgejo_connections.id, forgejo_connections.base_url,
            forgejo_connection_credentials.encrypted_credential
       FROM forgejo_connections
       JOIN forgejo_connection_credentials
         ON forgejo_connection_credentials.connection_id =
            forgejo_connections.id
       JOIN forgejo_repositories
             ON forgejo_repositories.connection_id = forgejo_connections.id
      WHERE forgejo_repositories.forge_repository_id = ?
        AND forgejo_connections.lifecycle = 'enabled'`,
    forgeRepositoryId,
  );
  if (
    !connection ||
    typeof connection.id !== "string" ||
    typeof connection.base_url !== "string" ||
    typeof connection.encrypted_credential !== "string"
  ) {
    fail("forgejo_repository_not_found", "Forgejo Repository was not found");
  }
  const repositories = durableCore.all(
    `SELECT forgejo_repositories.forge_repository_id AS id,
            forgejo_repositories.name AS full_name
       FROM forgejo_repositories
       JOIN repositories
         ON repositories.id = forgejo_repositories.repository_id
       JOIN forgejo_repository_polls
         ON forgejo_repository_polls.connection_id =
              forgejo_repositories.connection_id
        AND forgejo_repository_polls.forge_repository_id =
              forgejo_repositories.forge_repository_id
      WHERE forgejo_repositories.connection_id = ?
        AND (
          forgejo_repository_polls.baseline_status != 'complete'
          OR forgejo_repositories.forge_repository_id = ?
        )
        AND (
          repositories.lifecycle = 'enabled'
          OR forgejo_repositories.forge_repository_id = ?
        )
      ORDER BY forgejo_repositories.forge_repository_id`,
    connection.id,
    forgeRepositoryId,
    forgeRepositoryId,
  );
  if (
    repositories.length === 0 ||
    repositories.some(
      (/** @type {any} */ repository) =>
        !Number.isSafeInteger(repository?.id) ||
        typeof repository?.full_name !== "string",
    )
  ) {
    throw new TypeError("Forgejo Repository baseline set is invalid");
  }
  const repositoryIds = repositories.map((/** @type {any} */ repository) =>
    Number(repository.id),
  );
  const token = cipher.decrypt(connection.id, connection.encrypted_credential);
  const verification = await verifier.verify({
    baseUrl: connection.base_url,
    repositoryIds,
    token,
  });
  verifiedForgejoRepositories(verification, repositoryIds);
  const prepared = await polling.prepareBaseline(
    { base_url: connection.base_url, id: connection.id },
    token,
    repositories,
    { ignoreGate: true },
  );
  return {
    /** @param {any} transaction */
    commit(transaction) {
      polling.commitBaseline(transaction, connection.id, prepared);
    },
  };
}
