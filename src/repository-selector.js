import { fail, failUnavailable } from "./repository-validation.js";

/**
 * @param {{
 *   credentialCipher: ReturnType<typeof import("./repository-credential.js").createRepositoryCredentialCipher>,
 *   find: (id: string) => Record<string, import("node:sqlite").SQLInputValue>,
 *   objectDatabaseRoot: string,
 *   requireAcceptsNewWork: (id: string) => ReturnType<typeof import("./repository-resource.js").readRepositoryResource>,
 *   resolveForgeCredential?: (connectionId: string, provider: "github" | "forgejo") => Promise<{token: string, username: string}> | {token: string, username: string},
 *   resolveSelectors: typeof import("./repository-git.js").resolvePushedCommitSelectors
 * }} dependencies
 */
export function createRepositorySelectorResolver({
  credentialCipher,
  find,
  objectDatabaseRoot,
  requireAcceptsNewWork,
  resolveForgeCredential,
  resolveSelectors,
}) {
  /** @param {string} id @param {unknown} request */
  return async function resolvePushedSelectors(id, request) {
    const row = find(id);
    const repository = requireAcceptsNewWork(id);
    let credential =
      "forge_connection_id" in repository
        ? undefined
        : typeof row.encrypted_credential === "string"
          ? credentialCipher.decrypt(
              { id: repository.id, url: repository.url },
              row.encrypted_credential,
            )
          : undefined;
    if ("forge_connection_id" in repository) {
      if (typeof resolveForgeCredential !== "function") {
        fail(
          "repository_git_credentials_unavailable",
          "Forge Repository Git acquisition credentials are unavailable",
        );
      }
      try {
        credential = await resolveForgeCredential(
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
    return resolveSelectors(repository.url, credential, request, {
      objectDatabaseRoot,
    });
  };
}
