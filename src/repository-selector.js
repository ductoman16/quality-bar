import { fail } from "./repository-validation.js";

/**
 * @param {{
 *   credentialCipher: ReturnType<typeof import("./repository-credential.js").createRepositoryCredentialCipher>,
 *   find: (id: string) => Record<string, import("node:sqlite").SQLInputValue>,
 *   requireAcceptsNewWork: (id: string) => ReturnType<typeof import("./repository-resource.js").readRepositoryResource>,
 *   resolveSelectors: typeof import("./repository-git.js").resolvePushedCommitSelectors
 * }} dependencies
 */
export function createRepositorySelectorResolver({
  credentialCipher,
  find,
  requireAcceptsNewWork,
  resolveSelectors,
}) {
  /** @param {string} id @param {unknown} request */
  return function resolvePushedSelectors(id, request) {
    const row = find(id);
    const repository = requireAcceptsNewWork(id);
    if ("forge_connection_id" in repository) {
      fail(
        "repository_git_credentials_unavailable",
        "Forge Repository Git acquisition credentials are unavailable",
      );
    }
    const credential =
      typeof row.encrypted_credential === "string"
        ? credentialCipher.decrypt(
            { id: repository.id, url: repository.url },
            row.encrypted_credential,
          )
        : undefined;
    return resolveSelectors(repository.url, credential, request);
  };
}
