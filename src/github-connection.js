import { randomBytes as createRandomBytes, randomUUID } from "node:crypto";

import { createGitHubVerifier } from "./github-api.js";
import { createGitHubCallbackFailureStore } from "./github-callback-failure.js";
import {
  GITHUB_API_PROFILE,
  GITHUB_REQUIRED_PERMISSIONS,
  createGitHubAppManifest,
} from "./github-app-manifest.js";
import { createGitHubConnectionCredentialCipher } from "./github-connection-credential.js";
import { GitHubConnectionError } from "./github-connection-error.js";
import { readGitHubConnection } from "./github-connection-read.js";
import { createGitHubRepositorySelector } from "./github-repository-registration.js";

const FLOW_LIFETIME_MS = 60 * 60 * 1_000;

export { GitHubConnectionError } from "./github-connection-error.js";

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {never}
 */
function fail(code, message, cause) {
  throw new GitHubConnectionError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

/**
 * @typedef {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   transaction<Result>(callback: (transaction: {
 *     run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 *   }) => Result): Result
 * }} GitHubConnectionDurableCore
 */

/**
 * @param {GitHubConnectionDurableCore} durableCore
 * @param {{
 *   createId?: () => string | undefined,
 *   externalOrigin: string,
 *   masterKey: Buffer,
 *   now?: () => number,
 *   randomBytes?: (size: number) => Buffer,
 *   verifier?: {
 *     exchangeManifest: ReturnType<typeof createGitHubVerifier>["exchangeManifest"],
 *     verifyInstallation: ReturnType<typeof createGitHubVerifier>["verifyInstallation"],
 *     verifyRepositories?: ReturnType<typeof createGitHubVerifier>["verifyRepositories"]
 *   }
 * }} options
 */
export function createGitHubConnectionService(
  durableCore,
  {
    createId = randomUUID,
    externalOrigin,
    masterKey,
    now = () => Date.now(),
    randomBytes = createRandomBytes,
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
    typeof verifier?.exchangeManifest !== "function" ||
    typeof verifier.verifyInstallation !== "function"
  ) {
    throw new TypeError("GitHub Connection dependencies are invalid");
  }
  const cipher = createGitHubConnectionCredentialCipher(masterKey);
  for (const row of durableCore.all(
    `SELECT
       github_connections.id,
       github_connections.app_id,
       github_connection_credentials.encrypted_credential
     FROM github_connections
     JOIN github_connection_credentials
       ON github_connection_credentials.connection_id = github_connections.id`,
  )) {
    if (
      !row ||
      typeof row.id !== "string" ||
      !Number.isSafeInteger(row.app_id) ||
      typeof row.encrypted_credential !== "string"
    ) {
      cipher.destroy();
      throw new TypeError("GitHub Connection credential row is invalid");
    }
    cipher.decrypt(
      { appId: /** @type {number} */ (row.app_id), id: row.id },
      row.encrypted_credential,
    );
  }

  /** @type {Map<string, {
   *   createdAt: number,
   *   stage: "manifest",
   * } | {
   *   createdAt: number,
   *   stage: "installation",
   *   credential: {
   *     app_id: number,
   *     app_slug: string,
   *     client_id: string,
   *     owner: {id: number, login: string, type: "User"},
   *     pem: string
   *   }
   * }>} */
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

  const selectRepositories = createGitHubRepositorySelector(durableCore, {
    cipher,
    createId,
    timestamp,
    verifier,
  });

  /** @param {string} state @param {"manifest" | "installation"} stage */
  function take(state, stage) {
    const flow = pending.get(state);
    pending.delete(state);
    if (
      !flow ||
      flow.stage !== stage ||
      timestamp() - flow.createdAt > FLOW_LIFETIME_MS
    ) {
      fail(
        "github_manifest_state_invalid",
        "GitHub App Manifest state is invalid or expired",
      );
    }
    return flow;
  }

  return {
    read: () => readGitHubConnection(durableCore),
    start() {
      if (durableCore.all("SELECT id FROM github_connections LIMIT 1").length) {
        fail(
          "github_connection_conflict",
          "A GitHub Connection is already configured",
        );
      }
      const state = transientToken();
      pending.set(state, { createdAt: timestamp(), stage: "manifest" });
      return {
        action: `https://github.com/settings/apps/new?state=${encodeURIComponent(
          state,
        )}`,
        manifest: createGitHubAppManifest({ externalOrigin, state }),
        method: "POST",
        state,
      };
    },
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
      const id = createId();
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
      try {
        durableCore.transaction((transaction) => {
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
               id, connection_id, trigger, api_profile, principal_id,
               principal_login, permissions, capabilities, repositories,
               verified_at
             ) VALUES (?, ?, 'onboarding', ?, ?, ?, ?, ?, ?, ?)`,
            verificationId,
            id,
            GITHUB_API_PROFILE,
            verification.principal.id,
            verification.principal.login,
            permissions,
            capabilities,
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
      return {
        api_profile: GITHUB_API_PROFILE,
        app_id: flow.credential.app_id,
        app_slug: flow.credential.app_slug,
        capabilities: verification.capabilities,
        id,
        permissions: GITHUB_REQUIRED_PERMISSIONS,
        principal: verification.principal,
        repository_count: verification.repositories.length,
        verification_history: [
          {
            api_profile: GITHUB_API_PROFILE,
            capabilities: verification.capabilities,
            id: verificationId,
            permissions: GITHUB_REQUIRED_PERMISSIONS,
            principal: verification.principal,
            repositories: verification.repositories,
            trigger: "onboarding",
            verified_at: verifiedAt,
          },
        ],
        verified_at: verifiedAt,
      };
    },
    selectRepositories,
    destroy() {
      pending.clear();
      callbackFailures.destroy();
      cipher.destroy();
    },
  };
}

/** @param {unknown} error */
export function createUnavailableGitHubConnectionService(error) {
  return {
    read() {
      throw error;
    },
    start() {
      throw error;
    },
    async completeManifest() {
      throw error;
    },
    async completeInstallation() {
      throw error;
    },
    async selectRepositories() {
      throw error;
    },
    recordCallbackFailure() {
      throw error;
    },
    consumeCallbackFailure() {
      throw error;
    },
    destroy() {},
  };
}
