import { GitHubConnectionError } from "./github-connection-error.js";
import { recordGitHubConnectionVerification } from "./github-connection-verification.js";
import {
  validGitHubRepositoryEvidence,
  verifiedGitHubRepositoryEvidence,
} from "./github-verification-error.js";
import { githubVerificationErrorScope } from "./github-verification-scope.js";
import {
  failGitHubConnectionRotation,
  requireCurrentGitHubConnectionRotation,
  repositoryId,
  rotationRequest,
  sameJson,
  unionPositiveIds,
  uniquePositiveIds,
} from "./github-connection-rotation-support.js";
import {
  GITHUB_API_PROFILE,
  GITHUB_REQUIRED_PERMISSIONS,
  GITHUB_VERIFIED_CAPABILITIES,
} from "./github-app-manifest.js";

/**
 * @param {{cipher: {decrypt: (key: {appId: number, id: string}, encrypted: string) => {client_id: string | null, installation_id: number, pem: string}, encrypt: (key: {appId: number, id: string}, credential: {client_id: string | null, installation_id: number, pem: string}) => string}, createId: () => string | undefined, durableCore: {all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, any> | undefined)[], transaction<Result>(callback: (transaction: any) => Result): Result}, now: () => number, polling: {commitConnectionBaseline: (transaction: any, connectionId: string, prepared: any) => void, prepareConnectionBaseline: (credential: any, installationId: number, options?: {includeUnhealthy?: boolean, ignoreGate?: boolean, deferFailures?: boolean}) => Promise<any>}, read: () => unknown, registerSecret?: (secret: string) => unknown, verifier: {verifyInstallation: (credential: any, installationId: number, repositoryIds?: number[]) => Promise<any>}}} dependencies
 * @param {unknown} input
 */
export async function rotateGitHubConnection(
  {
    cipher,
    createId,
    durableCore,
    now,
    polling,
    read,
    registerSecret,
    verifier,
  },
  input,
) {
  const selected = rotationRequest(input);
  registerSecret?.(selected.pem);
  const [connection] = durableCore.all(
    `SELECT github_connections.*, github_connection_credentials.encrypted_credential
       FROM github_connections
       JOIN github_connection_credentials
         ON github_connection_credentials.connection_id = github_connections.id
      LIMIT 1`,
  );
  if (!connection) {
    failGitHubConnectionRotation(
      "github_connection_not_found",
      "GitHub Connection was not found",
    );
  }
  if (
    typeof connection.id !== "string" ||
    !Number.isSafeInteger(connection.app_id) ||
    typeof connection.app_slug !== "string" ||
    !Number.isSafeInteger(connection.installation_id) ||
    !Number.isSafeInteger(connection.principal_id) ||
    typeof connection.principal_login !== "string" ||
    typeof connection.api_profile !== "string" ||
    typeof connection.permissions !== "string" ||
    typeof connection.capabilities !== "string" ||
    !Number.isSafeInteger(connection.repository_count) ||
    typeof connection.encrypted_credential !== "string"
  ) {
    throw new TypeError("GitHub Connection credential row is invalid");
  }
  let persistedPermissions;
  let persistedCapabilities;
  try {
    persistedPermissions = JSON.parse(connection.permissions);
    persistedCapabilities = JSON.parse(connection.capabilities);
  } catch (error) {
    throw new TypeError("GitHub Connection verification profile is invalid", {
      cause: error,
    });
  }
  if (
    connection.api_profile !== GITHUB_API_PROFILE ||
    !sameJson(persistedPermissions, GITHUB_REQUIRED_PERMISSIONS)
  ) {
    failGitHubConnectionRotation(
      "github_connection_rotation_profile_invalid",
      "Configured GitHub Connection profile is invalid",
    );
  }
  const activeRepositories = durableCore.all(
    `SELECT github_repositories.forge_repository_id, github_repositories.name
       FROM github_repositories
       JOIN repositories ON repositories.id = github_repositories.repository_id
      WHERE github_repositories.connection_id = ?
        AND repositories.lifecycle = 'enabled'
      ORDER BY github_repositories.forge_repository_id`,
    connection.id,
  );
  const allRepositories = durableCore.all(
    `SELECT github_repositories.forge_repository_id
       FROM github_repositories
      WHERE github_repositories.connection_id = ?
      ORDER BY github_repositories.forge_repository_id`,
    connection.id,
  );
  if (
    activeRepositories.some(
      /** @param {Record<string, any> | undefined} repository */
      (repository) =>
        !repository ||
        typeof repository.name !== "string" ||
        repositoryId(repository) === null,
    ) ||
    allRepositories.some((repository) => repositoryId(repository) === null)
  ) {
    failGitHubConnectionRotation(
      "github_connection_repository_invalid",
      "GitHub Connection dependent Repository is invalid",
    );
  }
  const activeRepositoryIds = /** @type {number[]} */ (
    activeRepositories.map(
      /** @param {Record<string, any> | undefined} repository */ (repository) =>
        Number(repository?.forge_repository_id),
    )
  );
  const knownRepositoryIds = /** @type {number[]} */ (
    allRepositories.map(
      /** @param {Record<string, any> | undefined} repository */ (repository) =>
        Number(repository?.forge_repository_id),
    )
  );
  const affectedOnFailure = uniquePositiveIds(
    activeRepositoryIds.length > 0 ? activeRepositoryIds : knownRepositoryIds,
  );
  const verificationId = createId();
  const verifiedAt = now();
  if (
    typeof verificationId !== "string" ||
    verificationId.length === 0 ||
    !Number.isSafeInteger(verifiedAt)
  ) {
    throw new TypeError("GitHub Connection rotation identity is invalid");
  }
  const currentCredential = cipher.decrypt(
    { appId: connection.app_id, id: connection.id },
    connection.encrypted_credential,
  );
  const replacementCredential = {
    app_id: connection.app_id,
    app_slug: connection.app_slug,
    client_id: currentCredential.client_id,
    installation_id: connection.installation_id,
    owner: {
      id: connection.principal_id,
      login: connection.principal_login,
      type: "User",
    },
    pem: selected.pem,
  };
  /** @type {any | undefined} */
  let preparedBaseline;
  try {
    const repositoryIds =
      activeRepositoryIds.length > 0 ? activeRepositoryIds : undefined;
    const verification = await verifier.verifyInstallation(
      replacementCredential,
      connection.installation_id,
      repositoryIds,
    );
    const repositories = verification?.repositories;
    const verifiedIds = Array.isArray(repositories)
      ? repositories.map((repository) => repository?.id)
      : [];
    if (
      !verification ||
      !Array.isArray(repositories) ||
      repositories.length === 0 ||
      new Set(verifiedIds).size !== repositories.length ||
      repositories.some(
        (repository) =>
          !validGitHubRepositoryEvidence(
            repository,
            connection.principal_login,
          ),
      ) ||
      activeRepositoryIds.some((id) => !verifiedIds.includes(id)) ||
      !verification.principal ||
      typeof verification.principal !== "object" ||
      Array.isArray(verification.principal) ||
      verification.principal.type !== "User" ||
      !Number.isSafeInteger(verification.principal.id) ||
      verification.principal.id <= 0 ||
      typeof verification.principal.login !== "string" ||
      verification.principal.login.length === 0 ||
      verification.principal.id !== connection.principal_id ||
      verification.principal.login !== connection.principal_login ||
      !sameJson(persistedCapabilities, GITHUB_VERIFIED_CAPABILITIES) ||
      !sameJson(verification.capabilities, GITHUB_VERIFIED_CAPABILITIES)
    ) {
      failGitHubConnectionRotation(
        "github_connection_rotation_verification_invalid",
        "Replacement GitHub App verification result is invalid",
      );
    }
    preparedBaseline = await polling.prepareConnectionBaseline(
      replacementCredential,
      connection.installation_id,
      { deferFailures: true, ignoreGate: true, includeUnhealthy: true },
    );
    const encrypted = cipher.encrypt(
      { appId: connection.app_id, id: connection.id },
      {
        client_id: currentCredential.client_id,
        installation_id: connection.installation_id,
        pem: selected.pem,
      },
    );
    const evidence = /** @type {any[]} */ (repositories);
    const affected = uniquePositiveIds(
      evidence.map((repository) => repository.id),
    );
    if (!affected) {
      failGitHubConnectionRotation(
        "github_connection_rotation_verification_invalid",
        "Replacement GitHub App verification result is invalid",
      );
    }
    const verified = recordGitHubConnectionVerification(
      durableCore,
      {
        affectedRepositoryIds: affected,
        capabilities: verification.capabilities,
        completedRepositoryIds: activeRepositoryIds,
        createId: () => verificationId,
        evidence,
        id: connection.id,
        permissions: GITHUB_REQUIRED_PERMISSIONS,
        principal: verification.principal,
        profile: GITHUB_API_PROFILE,
        repositoryCount: connection.repository_count,
        timestamp: () => verifiedAt,
        trigger: "rotation",
      },
      { defer: true },
    );
    durableCore.transaction((/** @type {any} */ transaction) => {
      requireCurrentGitHubConnectionRotation(
        transaction,
        connection,
        activeRepositoryIds,
        "GitHub Connection changed during rotation",
      );
      const replacement = transaction.run(
        `UPDATE github_connection_credentials
            SET encrypted_credential = ?, created_at = ?
          WHERE connection_id = ? AND encrypted_credential = ?`,
        encrypted,
        verifiedAt,
        connection.id,
        connection.encrypted_credential,
      );
      if (replacement.changes !== 1) {
        failGitHubConnectionRotation(
          "github_connection_rotation_conflict",
          "GitHub App credentials changed during rotation",
        );
      }
      polling.commitConnectionBaseline(
        transaction,
        connection.id,
        preparedBaseline,
      );
      verified.commit(transaction);
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      typeof error.code !== "string"
    ) {
      throw error;
    }
    const coded = /** @type {Error & {code: string}} */ (error);
    let evidence = /** @type {any[]} */ ([]);
    if (coded instanceof GitHubConnectionError) {
      evidence = verifiedGitHubRepositoryEvidence(
        coded,
        connection.principal_login,
      );
    }
    const completed =
      unionPositiveIds([
        coded instanceof GitHubConnectionError
          ? (coded.completedRepositoryIds ?? [])
          : [],
      ])?.filter((id) => activeRepositoryIds.includes(id)) ?? [];
    const evidencedRepositoryIds = new Set(
      evidence.map((repository) => repository.id),
    );
    const reportedAffected =
      coded instanceof GitHubConnectionError
        ? (coded.affectedRepositoryIds ?? [])
        : [];
    const affected = unionPositiveIds([
      reportedAffected,
      completed,
      evidence.map((repository) => repository.id),
      affectedOnFailure ?? [],
    ]);
    if (!affected) {
      throw error;
    }
    const candidateRepositoryId =
      coded instanceof GitHubConnectionError &&
      Number.isSafeInteger(coded.repositoryId) &&
      affected.includes(Number(coded.repositoryId))
        ? Number(coded.repositoryId)
        : undefined;
    const errorRepositoryId = candidateRepositoryId;
    const scope =
      errorRepositoryId !== undefined &&
      githubVerificationErrorScope(coded.code) === "repository"
        ? "repository"
        : "connection";
    const failure = recordGitHubConnectionVerification(
      durableCore,
      {
        affectedRepositoryIds: affected,
        capabilities: evidence.length > 0 ? persistedCapabilities : null,
        completedRepositoryIds: completed.filter(
          (id) => affected.includes(id) && evidencedRepositoryIds.has(id),
        ),
        createId: () => verificationId,
        error: {
          code: coded.code,
          message: coded.message,
          ...(errorRepositoryId === undefined
            ? { scope }
            : { repositoryId: errorRepositoryId, scope }),
        },
        evidence,
        id: connection.id,
        permissions: evidence.length > 0 ? persistedPermissions : null,
        principal:
          evidence.length > 0
            ? { id: connection.principal_id, login: connection.principal_login }
            : null,
        profile: evidence.length > 0 ? connection.api_profile : null,
        repositoryCount: connection.repository_count,
        timestamp: () => verifiedAt,
        trigger: "rotation",
      },
      { defer: true },
    );
    durableCore.transaction((/** @type {any} */ transaction) => {
      requireCurrentGitHubConnectionRotation(
        transaction,
        connection,
        activeRepositoryIds,
        "GitHub Connection changed during rotation",
      );
      failure.commit(transaction);
    });
    throw error;
  }
  return read();
}

/** @param {Parameters<typeof rotateGitHubConnection>[0]} dependencies */
export function createGitHubConnectionRotation(dependencies) {
  return (/** @type {unknown} */ request) =>
    rotateGitHubConnection(dependencies, request);
}
