import { fail, failUnavailable } from "./repository-validation.ts";

export function createRepositorySelectorResolver({
  certificateAuthorityPath,
  credentialCipher,
  find,
  objectDatabaseRoot,
  requireAcceptsNewWork,
  resolveForgeCredential,
  resolveSelectors,
}: {
  certificateAuthorityPath?: string;
  credentialCipher: ReturnType<
    typeof import("./repository-credential.ts").createRepositoryCredentialCipher
  >;
  find: (id: string) => Record<string, import("node:sqlite").SQLInputValue>;
  objectDatabaseRoot: string;
  requireAcceptsNewWork: (
    id: string,
  ) => ReturnType<
    typeof import("./repository-resource.ts").readRepositoryResource
  >;
  resolveForgeCredential?: (
    connectionId: string,
    provider: "github" | "forgejo",
  ) =>
    | Promise<{ token: string; username: string }>
    | { token: string; username: string };
  resolveSelectors: (
    normalizedUrl: string,
    credential: { token: string; username: string } | undefined,
    request: unknown,
    options: {
      certificateAuthorityPath?: string;
      objectDatabaseRoot: string;
      pullRequestProvider?: "forgejo" | "github";
      useMergeBase?: boolean;
    },
  ) => Promise<import("./repository-git.ts").ResolvedPushedCommitSelectors>;
}) {
  return async function resolvePushedSelectors(
    id: string,
    request: unknown,
    options: {
      pullRequestProvider?: "forgejo" | "github";
      useMergeBase?: boolean;
    } = {},
  ) {
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
      certificateAuthorityPath,
      objectDatabaseRoot,
      ...("pullRequestProvider" in options
        ? { pullRequestProvider: options.pullRequestProvider }
        : {}),
      ...("useMergeBase" in options
        ? { useMergeBase: options.useMergeBase }
        : {}),
    });
  };
}
