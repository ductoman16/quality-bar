import { randomBytes as createRandomBytes, randomUUID } from "node:crypto";
import { createGitHubVerifier } from "./github-api.js";
import { createGitHubCallbackFailureStore } from "./github-callback-failure.js";
import {
  GITHUB_API_PROFILE,
  GITHUB_REQUIRED_PERMISSIONS,
} from "./github-app-manifest.js";
import {
  createGitHubConnectionCredentialCipher,
  validatePersistedGitHubCredentials,
} from "./github-connection-credential.js";
import {
  GitHubConnectionError,
  failGitHubConnection as fail,
} from "./github-connection-error.js";
import { takeGitHubConnectionFlow } from "./github-connection-flow.js";
import { readGitHubConnection } from "./github-connection-read.js";
import { reactivateGitHubConnection } from "./github-connection-reactivation.js";
import { startGitHubConnection } from "./github-connection-start.js";
import {
  removeNeverUsedGitHubConnection,
  retireGitHubConnection,
} from "./github-connection-lifecycle.js";
import { createGitHubRepositorySelector } from "./github-repository-registration.js";
import { createGitHubRepositoryGitCredential } from "./github-repository-git-credential.js";
import { createGitHubPollingRunner } from "./github-polling-runner.js";
export { GitHubConnectionError } from "./github-connection-error.js";
/** @typedef {{createInstallationToken?: (credential: any, installationId: number) => Promise<string>, exchangeManifest: (code: string) => Promise<any>, listPullRequests: (credential: any, installationId: number, repository: any) => Promise<any>, verifyInstallation: (credential: any, installationId: number) => Promise<any>, verifyRepositories: (credential: any, installationId: number, repositoryIds: number[]) => Promise<any>}} GitHubVerifier */
/** @param {any} durableCore @param {{acquirePullRequestChangeset: (input: {repositoryId: string, pullRequest: any}) => Promise<any>, admitAutomaticEvaluation: (transaction: any, input: {changeset: any, pullRequestNumber: number, repositoryId: string}) => any, createId?: () => string | undefined, externalOrigin: string, masterKey: Buffer, now?: () => number, randomBytes?: (size: number) => Buffer, storageReserve: {assertPollingObservationAdvanceAvailable: () => unknown, preparePollingObservationAdvance: () => unknown}, verifier?: GitHubVerifier}} options */
export function createGitHubConnectionService(
  durableCore,
  {
    acquirePullRequestChangeset,
    admitAutomaticEvaluation,
    createId = randomUUID,
    externalOrigin,
    masterKey,
    now = () => Date.now(),
    randomBytes = createRandomBytes,
    storageReserve,
    verifier = createGitHubVerifier(),
  },
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore.transaction !== "function"
  ) {
    throw new TypeError("durableCore must provide reads and transactions");
  }
  if (
    typeof createId !== "function" ||
    typeof now !== "function" ||
    typeof randomBytes !== "function" ||
    typeof storageReserve?.assertPollingObservationAdvanceAvailable !==
      "function" ||
    typeof storageReserve.preparePollingObservationAdvance !== "function" ||
    typeof verifier?.exchangeManifest !== "function" ||
    typeof verifier.verifyInstallation !== "function" ||
    typeof verifier.verifyRepositories !== "function" ||
    typeof verifier.listPullRequests !== "function"
  ) {
    throw new TypeError("GitHub Connection dependencies are invalid");
  }
  const cipher = createGitHubConnectionCredentialCipher(masterKey);
  validatePersistedGitHubCredentials(durableCore, cipher);
  const pending = new Map();
  const callbackFailures = createGitHubCallbackFailureStore({
    now: timestamp,
    randomBytes,
  });
  function timestamp() {
    const value = now();
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("now must return a safe integer timestamp");
    }
    return value;
  }
  function transientToken() {
    const value = randomBytes(32).toString("base64url");
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(value)) {
      throw new TypeError("randomBytes must return usable entropy");
    }
    return value;
  }
  const polling = createGitHubPollingRunner(durableCore, {
    acquirePullRequestChangeset,
    admitAutomaticEvaluation,
    cipher,
    storageReserve,
    timestamp,
    verifier,
  });
  const selectRepositories = createGitHubRepositorySelector(durableCore, {
    cipher,
    createId,
    timestamp,
    verifier: polling.repositoryVerifier,
  });
  const acquireRepositoryGitCredential = createGitHubRepositoryGitCredential(
    durableCore,
    { cipher, verifier },
  );
  const take = takeGitHubConnectionFlow.bind(null, { pending, timestamp });
  return {
    read: () => readGitHubConnection(durableCore),
    acquireRepositoryGitCredential,
    startPolling: polling.start,
    start: () =>
      startGitHubConnection({
        durableCore,
        externalOrigin,
        pending,
        timestamp,
        transientToken,
      }),
    /** @param {Error & {code: string}} error */
    recordCallbackFailure(error) {
      return callbackFailures.record(error);
    },
    /** @param {string} receipt */
    consumeCallbackFailure(receipt) {
      return callbackFailures.consume(receipt);
    },
    /** @param {{code: string, state: string}} input */
    async completeManifest({ code, state }) {
      if (
        typeof code !== "string" ||
        code.length === 0 ||
        typeof state !== "string"
      ) {
        fail(
          "github_manifest_callback_invalid",
          "GitHub App Manifest callback is invalid",
        );
      }
      const flow = take(state, "manifest");
      if (flow.stage !== "manifest") {
        throw new TypeError("GitHub flow stage is invalid");
      }
      let credential;
      try {
        credential = await verifier.exchangeManifest(code);
      } catch (error) {
        if (error instanceof GitHubConnectionError) {
          throw error;
        }
        fail(
          "github_manifest_exchange_failed",
          "GitHub App Manifest exchange failed",
          error,
        );
      }
      pending.set(state, {
        createdAt: flow.createdAt,
        credential,
        stage: "installation",
      });
      return `https://github.com/apps/${encodeURIComponent(
        credential.app_slug,
      )}/installations/new`;
    },
    /** @param {{installationId: string, state: string}} input */
    async completeInstallation({ installationId, state }) {
      if (
        typeof installationId !== "string" ||
        !/^[1-9][0-9]*$/.test(installationId) ||
        !Number.isSafeInteger(Number(installationId)) ||
        typeof state !== "string"
      ) {
        fail(
          "github_installation_callback_invalid",
          "GitHub App installation callback is invalid",
        );
      }
      const flow = take(state, "installation");
      if (flow.stage !== "installation") {
        throw new TypeError("GitHub flow stage is invalid");
      }
      const installation = Number(installationId);
      const verification = await verifier.verifyInstallation(
        flow.credential,
        installation,
      );
      const [existing] = /** @type {any[]} */ (
        durableCore.all(
          `SELECT id, app_id, app_slug, installation_id, principal_id,
                  principal_login, lifecycle
         FROM github_connections LIMIT 1`,
        )
      );
      const reactivating = existing?.lifecycle === "retired";
      if (
        reactivating &&
        (!Number.isSafeInteger(existing.app_id) ||
          !Number.isSafeInteger(existing.installation_id) ||
          !Number.isSafeInteger(existing.principal_id) ||
          existing.app_id !== flow.credential.app_id ||
          existing.app_slug !== flow.credential.app_slug ||
          existing.installation_id !== installation ||
          existing.principal_id !== verification.principal.id ||
          existing.principal_login !== verification.principal.login)
      ) {
        fail(
          "github_connection_identity_mismatch",
          "GitHub Connection reactivation must verify the same installation identity",
        );
      }
      const id = reactivating ? existing.id : createId();
      const verificationId = createId();
      const verifiedAt = timestamp();
      if (
        typeof id !== "string" ||
        id.length === 0 ||
        typeof verificationId !== "string" ||
        verificationId.length === 0
      ) {
        throw new TypeError("createId must return nonempty strings");
      }
      const encryptedCredential = cipher.encrypt(
        { appId: flow.credential.app_id, id },
        {
          client_id: flow.credential.client_id,
          installation_id: installation,
          pem: flow.credential.pem,
        },
      );
      const capabilities = JSON.stringify(verification.capabilities);
      const permissions = JSON.stringify(GITHUB_REQUIRED_PERMISSIONS);
      const repositories = JSON.stringify(verification.repositories);
      const affectedRepositoryIds = JSON.stringify(
        verification.repositories.map(
          /** @param {any} repository */ (repository) => repository.id,
        ),
      );
      const repositoryChecks = JSON.stringify(
        verification.repositories.map(
          /** @param {any} repository */ (repository) => ({
            outcome: "success",
            repository_id: repository.id,
          }),
        ),
      );
      const preparedBaseline = reactivating
        ? await polling.prepareConnectionBaseline(flow.credential, installation)
        : null;
      try {
        durableCore.transaction((/** @type {any} */ transaction) => {
          if (reactivating) {
            polling.commitConnectionBaseline(transaction, id, preparedBaseline);
            transaction.run(
              `UPDATE github_connections
               SET lifecycle = 'enabled', app_slug = ?, principal_login = ?,
                   api_profile = ?, permissions = ?, capabilities = ?,
                   repository_count = ?, health = 'healthy',
                   health_error_code = NULL, health_error_message = NULL,
                   verified_at = ?
               WHERE id = ?`,
              flow.credential.app_slug,
              verification.principal.login,
              GITHUB_API_PROFILE,
              permissions,
              capabilities,
              verification.repositories.length,
              verifiedAt,
              id,
            );
          } else {
            transaction.run(
              `INSERT INTO github_connections (
               id, app_id, app_slug, installation_id,
               principal_id, principal_login, api_profile,
               permissions, capabilities, repository_count,
               created_at, verified_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              id,
              flow.credential.app_id,
              flow.credential.app_slug,
              installation,
              verification.principal.id,
              verification.principal.login,
              GITHUB_API_PROFILE,
              permissions,
              capabilities,
              verification.repositories.length,
              verifiedAt,
              verifiedAt,
            );
          }
          transaction.run(
            `INSERT INTO github_connection_credentials (
               connection_id, encrypted_credential, created_at
             ) VALUES (?, ?, ?)`,
            id,
            encryptedCredential,
            verifiedAt,
          );
          transaction.run(
            `INSERT INTO github_connection_verifications (
               id, connection_id, trigger, outcome, error_code,
               error_message, error_repository_id, api_profile, principal_id,
               principal_login, permissions, capabilities,
               affected_repository_ids, repository_checks, repositories,
               verified_at
             ) VALUES (
               ?, ?, ?, 'success', NULL, NULL, NULL,
               ?, ?, ?, ?, ?, ?, ?, ?, ?
             )`,
            verificationId,
            id,
            reactivating ? "enablement" : "onboarding",
            GITHUB_API_PROFILE,
            verification.principal.id,
            verification.principal.login,
            permissions,
            capabilities,
            affectedRepositoryIds,
            repositoryChecks,
            repositories,
            verifiedAt,
          );
        });
      } catch (error) {
        if (
          error instanceof Error &&
          /UNIQUE constraint failed: github_connections/.test(error.message)
        ) {
          fail(
            "github_connection_conflict",
            "A GitHub Connection is already configured",
          );
        }
        throw error;
      }
      if (reactivating) {
        return readGitHubConnection(durableCore);
      }
      return {
        api_profile: GITHUB_API_PROFILE,
        app_id: flow.credential.app_id,
        app_slug: flow.credential.app_slug,
        capabilities: verification.capabilities,
        health: "healthy",
        health_error: null,
        id,
        lifecycle: "enabled",
        permissions: GITHUB_REQUIRED_PERMISSIONS,
        polling: [],
        polling_failure: null,
        principal: verification.principal,
        repository_count: verification.repositories.length,
        verification_history: [
          {
            affected_repository_ids: verification.repositories.map(
              /** @param {any} repository */ (repository) => repository.id,
            ),
            api_profile: GITHUB_API_PROFILE,
            capabilities: verification.capabilities,
            error: null,
            id: verificationId,
            outcome: "success",
            permissions: GITHUB_REQUIRED_PERMISSIONS,
            principal: verification.principal,
            repositories: verification.repositories,
            repository_checks: verification.repositories.map(
              /** @param {any} repository */ (repository) => ({
                outcome: "success",
                repository_id: repository.id,
              }),
            ),
            trigger: "onboarding",
            verified_at: verifiedAt,
          },
        ],
        verified_at: verifiedAt,
      };
    },
    /** @param {unknown} request */
    async reactivate(request) {
      return reactivateGitHubConnection(
        {
          completeInstallation: this.completeInstallation,
          durableCore,
          pending,
          timestamp,
          transientToken,
        },
        request,
      );
    },
    retire: (/** @type {unknown} */ request) =>
      retireGitHubConnection(durableCore, request),
    remove: () => removeNeverUsedGitHubConnection(durableCore),
    selectRepositories,
    destroy() {
      polling.destroy();
      pending.clear();
      callbackFailures.destroy();
      cipher.destroy();
    },
  };
}
export { createUnavailableGitHubConnectionService } from "./github-connection-unavailable.js";
