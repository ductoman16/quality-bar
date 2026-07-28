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
  const [row] = durableCore.all(
    `SELECT forgejo_connections.id, forgejo_connections.base_url,
            forgejo_connection_credentials.encrypted_credential,
            forgejo_repositories.name
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
    !row ||
    typeof row.id !== "string" ||
    typeof row.base_url !== "string" ||
    typeof row.encrypted_credential !== "string" ||
    typeof row.name !== "string"
  ) {
    fail("forgejo_repository_not_found", "Forgejo Repository was not found");
  }
  const token = cipher.decrypt(row.id, row.encrypted_credential);
  const verification = await verifier.verify({
    baseUrl: row.base_url,
    repositoryIds: [forgeRepositoryId],
    token,
  });
  verifiedForgejoRepositories(verification, [forgeRepositoryId]);
  const prepared = await polling.prepareBaseline(
    { base_url: row.base_url, id: row.id },
    token,
    [{ full_name: row.name, id: forgeRepositoryId }],
    { ignoreGate: true },
  );
  return {
    /** @param {any} transaction */
    commit(transaction) {
      polling.commitBaseline(transaction, row.id, prepared);
    },
  };
}
