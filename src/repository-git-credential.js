import { fail, failUnavailable } from "./repository-validation.js";

/**
 * @param {{
 *   credentialCipher: {decrypt: (identity: any, encrypted: string) => any},
 *   find: (id: string) => any,
 *   readRepository: (row: any) => any,
 *   resolveForgeCredential?: (connectionId: string, provider: "github" | "forgejo") => Promise<any> | any
 * }} dependencies
 */
export function createRepositoryGitCredentialAcquirer({
  credentialCipher,
  find,
  readRepository,
  resolveForgeCredential,
}) {
  /** @param {string} id */
  return async function acquireGitCredential(id) {
    const row = find(id);
    const repository = readRepository(row);
    if ("forge_connection_id" in repository) {
      if (typeof resolveForgeCredential !== "function") {
        fail(
          "repository_git_credentials_unavailable",
          "Forge Repository Git acquisition credentials are unavailable",
        );
      }
      try {
        return await resolveForgeCredential(
          repository.forge_connection_id,
          repository.provider,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          typeof error.code === "string"
        ) {
          failUnavailable(error.code, error.message, error);
        }
        throw error;
      }
    }
    return typeof row.encrypted_credential === "string"
      ? credentialCipher.decrypt(
          { id: repository.id, url: repository.url },
          row.encrypted_credential,
        )
      : undefined;
  };
}
