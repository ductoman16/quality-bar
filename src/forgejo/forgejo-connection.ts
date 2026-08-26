import { randomUUID } from "node:crypto";

import { createForgejoConnectionCredentialCipher } from "./forgejo-connection-credential.ts";
import { readForgejoConnection } from "./forgejo-connection-read.ts";
import {
  reactivateForgejoConnection,
  removeNeverUsedForgejoConnection,
  retireForgejoConnection,
} from "./forgejo-connection-lifecycle.ts";
import {
  rotateForgejoConnection,
  verifiedForgejoRepositories,
} from "./forgejo-connection-rotation.ts";
import {
  createForgejoVerifier,
  normalizedForgejoBaseUrl,
} from "./forgejo-verifier.ts";
import { createForgejoPollingRunner } from "./forgejo-polling-runner.ts";
import { prepareForgejoRepositoryEnablement } from "./forgejo-repository-enablement.ts";
import { createForgejoPublicationServices } from "./forgejo-publication-services.ts";
import { forgejoPublicationCapabilities } from "./forgejo-publication-capabilities.ts";

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function request(input: unknown) {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    fail(
      "forgejo_connection_request_invalid",
      "Forgejo Connection request is invalid",
    );
  }
  const value = input as Record<string, unknown>;
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

function discoveryRequest(input: unknown) {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    fail(
      "forgejo_connection_request_invalid",
      "Forgejo Connection request is invalid",
    );
  }
  const value = input as Record<string, unknown>;
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

export function createForgejoConnectionService(
  durableCore: {
    all: (
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ) => (Record<string, import("node:sqlite").SQLInputValue> | undefined)[];
    get: (
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ) => Record<string, import("node:sqlite").SQLInputValue> | undefined;
    transaction: <Result>(
      callback: (transaction: {
        run: (
          sql: string,
          ...parameters: import("node:sqlite").SQLInputValue[]
        ) => unknown;
      }) => Result,
    ) => Result;
  },
  {
    acquirePullRequestChangeset,
    admitAutomaticEvaluation,
    certificateAuthorityPath,
    createId = randomUUID,
    externalOrigin = "http://quality-bar.example",
    masterKey,
    now = () => Date.now(),
    registerSecret,
    storageReserve,
    verifier = createForgejoVerifier({ certificateAuthorityPath }),
  }: {
    acquirePullRequestChangeset: (input: {
      repositoryId: string;
      pullRequest: any;
    }) => Promise<any>;
    admitAutomaticEvaluation: (
      transaction: any,
      input: {
        changeset: any;
        provider: "forgejo";
        pullRequestNumber: number;
        repositoryId: string;
      },
    ) => any;
    certificateAuthorityPath?: string;
    createId?: () => string | undefined;
    externalOrigin?: string;
    masterKey: Buffer;
    now?: () => number;
    registerSecret?: (secret: string) => unknown;
    storageReserve: {
      assertPollingObservationAdvanceAvailable: () => unknown;
      ioPool: any;
      preparePollingObservationAdvance: () => unknown;
    };
    verifier?: {
      listPullRequests: (connection: any, repository: any) => Promise<any[]>;
      publishAggregateFeedback?: (
        connection: any,
        repository: any,
        pullRequestNumber: number,
        body: string,
      ) => Promise<number>;
      publishCommitStatus?: (
        connection: any,
        repository: any,
        status: any,
      ) => Promise<number>;
      publishInlineFeedback?: (
        connection: any,
        repository: any,
        pullRequestNumber: number,
        comment: any,
      ) => Promise<number>;
      reconcileAggregateFeedback?: (
        connection: any,
        repository: any,
        pullRequestNumber: number,
        body: string,
      ) => Promise<number | null>;
      reconcileCommitStatus?: (
        connection: any,
        repository: any,
        status: any,
      ) => Promise<number | null>;
      reconcileInlineFeedback?: (
        connection: any,
        repository: any,
        pullRequestNumber: number,
        comment: any,
      ) => Promise<number | null>;
      verify: (input: any) => Promise<any>;
    };
  },
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore?.get !== "function" ||
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
  const publicationVerifier = forgejoPublicationCapabilities(verifier);
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
    acquireRepositoryGitCredential(connectionId: string) {
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
    async discover(input: unknown) {
      const selected = discoveryRequest(input);
      registerSecret?.(selected.token);
      const verification = await verifier.verify(selected);
      return verification.repositories;
    },
    async connect(input: unknown) {
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
        verification.repositories.map((repository: any) => ({
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
            const repository = candidate as NonNullable<typeof candidate>;
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
    async rotate(input: unknown) {
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
    async prepareRepositoryEnablement(forgeRepositoryId: number) {
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
    async reactivate(input: unknown) {
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
    retire(input: unknown) {
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
