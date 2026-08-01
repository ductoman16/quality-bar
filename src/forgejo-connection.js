import { randomUUID } from "node:crypto";

import { createForgejoConnectionCredentialCipher } from "./forgejo-connection-credential.js";
import { readForgejoConnection } from "./forgejo-connection-read.js";
import {
  reactivateForgejoConnection,
  removeNeverUsedForgejoConnection,
  retireForgejoConnection,
} from "./forgejo-connection-lifecycle.js";
import {
  rotateForgejoConnection,
  verifiedForgejoRepositories,
} from "./forgejo-connection-rotation.js";
import {
  createForgejoV16Verifier,
  normalizedForgejoBaseUrl,
} from "./forgejo-v16.js";
import { createForgejoPollingRunner } from "./forgejo-polling-runner.js";
import { prepareForgejoRepositoryEnablement } from "./forgejo-repository-enablement.js";
import { createForgejoPublicationServices } from "./forgejo-publication-services.js";

/** @param {string} code @param {string} message @returns {never} */
function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

/** @param {unknown} input */
function request(input) {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    fail(
      "forgejo_connection_request_invalid",
      "Forgejo Connection request is invalid",
    );
  }
  const value = /** @type {Record<string, unknown>} */ (input);
  if (
    Object.keys(value).length !== 3 ||
    typeof value.base_url !== "string" ||
    typeof value.token !== "string" ||
    !Array.isArray(value.repository_ids)
  ) {
    fail(
      "forgejo_connection_request_invalid",
      "Forgejo Connection request is invalid",
    );
  }
  return {
    baseUrl: normalizedForgejoBaseUrl(value.base_url),
    repositoryIds: value.repository_ids,
    token: value.token,
  };
}

/** @param {unknown} input */
function discoveryRequest(input) {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    fail(
      "forgejo_connection_request_invalid",
      "Forgejo Connection request is invalid",
    );
  }
  const value = /** @type {Record<string, unknown>} */ (input);
  if (
    Object.keys(value).length !== 2 ||
    typeof value.base_url !== "string" ||
    typeof value.token !== "string"
  ) {
    fail(
      "forgejo_connection_request_invalid",
      "Forgejo Connection request is invalid",
    );
  }
  return {
    baseUrl: normalizedForgejoBaseUrl(value.base_url),
    token: value.token,
  };
}

/**
 * @param {{all: (sql: string, ...parameters: import("node:sqlite").SQLInputValue[]) => (Record<string, import("node:sqlite").SQLInputValue> | undefined)[], transaction: <Result>(callback: (transaction: {run: (sql: string, ...parameters: import("node:sqlite").SQLInputValue[]) => unknown}) => Result) => Result}} durableCore
 * @param {{acquirePullRequestChangeset: (input: {repositoryId: string, pullRequest: any}) => Promise<any>, admitAutomaticEvaluation: (transaction: any, input: {changeset: any, provider: "forgejo", pullRequestNumber: number, repositoryId: string}) => any, createId?: () => string | undefined, externalOrigin?: string, masterKey: Buffer, now?: () => number, registerSecret?: (secret: string) => unknown, storageReserve: {assertPollingObservationAdvanceAvailable: () => unknown, ioPool: any, preparePollingObservationAdvance: () => unknown}, verifier?: {listPullRequests: (connection: any, repository: any) => Promise<any[]>, publishAggregateFeedback?: (connection: any, repository: any, pullRequestNumber: number, body: string) => Promise<number>, publishCommitStatus?: (connection: any, repository: any, status: any) => Promise<number>, publishInlineFeedback?: (connection: any, repository: any, pullRequestNumber: number, comment: any) => Promise<number>, verify: (input: any) => Promise<any>}}} options
 */
export function createForgejoConnectionService(
  durableCore,
  {
    acquirePullRequestChangeset,
    admitAutomaticEvaluation,
    createId = randomUUID,
    externalOrigin = "http://quality-bar.example",
    masterKey,
    now = () => Date.now(),
    registerSecret,
    storageReserve,
    verifier = createForgejoV16Verifier(),
  },
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore.transaction !== "function" ||
    typeof createId !== "function" ||
    typeof acquirePullRequestChangeset !== "function" ||
    typeof admitAutomaticEvaluation !== "function" ||
    typeof storageReserve?.ioPool?.run !== "function" ||
    typeof now !== "function" ||
    typeof storageReserve?.assertPollingObservationAdvanceAvailable !==
      "function" ||
    typeof storageReserve.preparePollingObservationAdvance !== "function" ||
    typeof verifier?.verify !== "function" ||
    typeof verifier.listPullRequests !== "function"
  ) {
    throw new TypeError("Forgejo Connection dependencies are invalid");
  }
  const cipher = createForgejoConnectionCredentialCipher(masterKey, {
    onSecret: registerSecret,
  });
  for (const row of durableCore.all(
    "SELECT connection_id, encrypted_credential FROM forgejo_connection_credentials",
  )) {
    if (
      !row ||
      typeof row.connection_id !== "string" ||
      typeof row.encrypted_credential !== "string"
    ) {
      cipher.destroy();
      throw new TypeError("Forgejo credential row is invalid");
    }
    cipher.decrypt(row.connection_id, row.encrypted_credential);
  }
  const polling = createForgejoPollingRunner(durableCore, {
    acquirePullRequestChangeset,
    admitAutomaticEvaluation,
    cipher,
    storageReserve,
    timestamp: now,
    verifier,
  });
  const missingPublicationCapability = async () => {
    throw Object.assign(
      new Error("Forgejo publication capability is unavailable"),
      { code: "forgejo_publication_capability_unavailable" },
    );
  };
  const publicationVerifier = {
    ...verifier,
    publishAggregateFeedback:
      verifier.publishAggregateFeedback ?? missingPublicationCapability,
    publishCommitStatus:
      verifier.publishCommitStatus ?? missingPublicationCapability,
    publishInlineFeedback:
      verifier.publishInlineFeedback ?? missingPublicationCapability,
  };
  const publications = createForgejoPublicationServices(durableCore, {
    cipher,
    externalOrigin,
    ioPool: storageReserve.ioPool,
    now,
    verifier: publicationVerifier,
  });
  return {
    read() {
      return readForgejoConnection(durableCore);
    },
    /** @param {string} connectionId */
    acquireRepositoryGitCredential(connectionId) {
      const [connection] = durableCore.all(
        `SELECT
           forgejo_connections.id,
           forgejo_connection_credentials.encrypted_credential
         FROM forgejo_connections
         JOIN forgejo_connection_credentials
           ON forgejo_connection_credentials.connection_id =
              forgejo_connections.id
         WHERE forgejo_connections.id = ?`,
        connectionId,
      );
      if (
        !connection ||
        typeof connection.id !== "string" ||
        typeof connection.encrypted_credential !== "string"
      ) {
        throw new TypeError("Forgejo Connection credential row is invalid");
      }
      return {
        token: cipher.decrypt(connection.id, connection.encrypted_credential),
        username: "oauth2",
      };
    },
    /** @param {unknown} input */
    async discover(input) {
      const selected = discoveryRequest(input);
      registerSecret?.(selected.token);
      const verification = await verifier.verify(selected);
      return verification.repositories;
    },
    /** @param {unknown} input */
    async connect(input) {
      const selected = request(input);
      registerSecret?.(selected.token);
      const verification = await verifier.verify(selected);
      verifiedForgejoRepositories(verification, selected.repositoryIds);
      const id = createId();
      const verificationId = createId();
      const verifiedAt = now();
      if (
        typeof id !== "string" ||
        !id ||
        typeof verificationId !== "string" ||
        !verificationId ||
        !Number.isSafeInteger(verifiedAt)
      ) {
        throw new TypeError("Forgejo Connection identity is invalid");
      }
      const preparedBaseline = await polling.prepareBaseline(
        { base_url: selected.baseUrl, id },
        selected.token,
        verification.repositories.map((/** @type {any} */ repository) => ({
          full_name: repository.full_name,
          id: repository.id,
        })),
        { recordFailure: false },
      );
      const encrypted = cipher.encrypt(id, selected.token);
      try {
        durableCore.transaction((transaction) => {
          transaction.run(
            "INSERT INTO forgejo_connections (id, base_url, api_profile, reported_version, principal_id, principal_login, scopes, capabilities, health, created_at, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'healthy', ?, ?)",
            id,
            selected.baseUrl,
            verification.profile,
            verification.reported_version,
            verification.principal.id,
            verification.principal.login,
            JSON.stringify(verification.scopes),
            JSON.stringify(verification.capabilities),
            verifiedAt,
            verifiedAt,
          );
          transaction.run(
            "INSERT INTO forgejo_connection_credentials (connection_id, encrypted_credential, created_at) VALUES (?, ?, ?)",
            id,
            encrypted,
            verifiedAt,
          );
          transaction.run(
            "INSERT INTO forgejo_connection_verifications (id, connection_id, trigger, profile, reported_version, principal, scopes, capabilities, repositories, error_code, error_message, verified_at) VALUES (?, ?, 'onboarding', ?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
            verificationId,
            id,
            verification.profile,
            verification.reported_version,
            JSON.stringify(verification.principal),
            JSON.stringify(verification.scopes),
            JSON.stringify(verification.capabilities),
            JSON.stringify(verification.repositories),
            verifiedAt,
          );
          for (const candidate of verification.repositories) {
            const repository = /** @type {NonNullable<typeof candidate>} */ (
              candidate
            );
            const repositoryId = createId();
            if (typeof repositoryId !== "string" || !repositoryId) {
              throw new TypeError("Forgejo Repository identity is invalid");
            }
            transaction.run(
              "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
              repositoryId,
              repository.clone_url,
              verifiedAt,
              verifiedAt,
            );
            transaction.run(
              "INSERT INTO forgejo_repositories (repository_id, connection_id, verification_id, forge_repository_id, name, api_url, web_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
              repositoryId,
              id,
              verificationId,
              repository.id,
              repository.full_name,
              repository.api_url,
              repository.html_url,
            );
          }
          polling.commitBaseline(transaction, id, preparedBaseline);
        });
      } catch (error) {
        if (
          error instanceof Error &&
          /forgejo_connections\.singleton|forgejo_connections_singleton/.test(
            error.message,
          )
        ) {
          fail(
            "forgejo_connection_conflict",
            "A Forgejo Connection is already configured",
          );
        }
        if (
          error instanceof Error &&
          /UNIQUE constraint failed/.test(error.message)
        ) {
          fail(
            "forgejo_repository_identity_conflict",
            "Forgejo Repository identity is already registered",
          );
        }
        throw error;
      }
      return this.read();
    },
    /** @param {unknown} input */
    async rotate(input) {
      return rotateForgejoConnection(
        {
          cipher,
          createId,
          durableCore,
          now,
          polling,
          read: () => this.read(),
          registerSecret,
          verifier,
        },
        input,
      );
    },
    /** @param {number} forgeRepositoryId */
    async prepareRepositoryEnablement(forgeRepositoryId) {
      return prepareForgejoRepositoryEnablement(
        durableCore,
        cipher,
        verifier,
        polling,
        createId,
        now,
        forgeRepositoryId,
      );
    },
    /** @param {unknown} input */
    async reactivate(input) {
      return reactivateForgejoConnection(
        {
          cipher,
          createId,
          durableCore,
          now,
          polling,
          readConnection: () => this.read(),
          registerSecret,
          verifier,
        },
        input,
      );
    },
    /** @param {unknown} input */
    retire(input) {
      return retireForgejoConnection(durableCore, input, () => this.read());
    },
    remove() {
      removeNeverUsedForgejoConnection(durableCore);
    },
    runPolling: polling.runDue,
    publishWaiting: publications.publishWaiting,
    requireFreshBaseline: polling.requireFreshBaseline,
    startPolling() {
      polling.start();
      publications.start();
    },
    stopPolling() {
      publications.stop();
      polling.destroy();
    },
    destroy() {
      this.stopPolling();
      cipher.destroy();
    },
  };
}

/** @param {Error & {code?: string}} error */
export function unavailableForgejoConnectionService(error) {
  return {
    read() {
      throw error;
    },
    acquireRepositoryGitCredential() {
      throw error;
    },
    async discover() {
      throw error;
    },
    async connect() {
      throw error;
    },
    async rotate() {
      throw error;
    },
    async prepareRepositoryEnablement() {
      throw error;
    },
    async reactivate() {
      throw error;
    },
    retire() {
      throw error;
    },
    remove() {
      throw error;
    },
    async runPolling() {
      throw error;
    },
    async publishWaiting() {
      throw error;
    },
    requireFreshBaseline() {
      throw error;
    },
    startPolling() {},
    stopPolling() {},
    destroy() {},
  };
}
