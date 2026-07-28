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
 * @param {{createId?: () => string | undefined, masterKey: Buffer, now?: () => number, verifier?: {verify: (input: any) => Promise<any>}}} options
 */
export function createForgejoConnectionService(
  durableCore,
  {
    createId = randomUUID,
    masterKey,
    now = () => Date.now(),
    verifier = createForgejoV16Verifier(),
  },
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore.transaction !== "function" ||
    typeof createId !== "function" ||
    typeof now !== "function" ||
    typeof verifier?.verify !== "function"
  ) {
    throw new TypeError("Forgejo Connection dependencies are invalid");
  }
  const cipher = createForgejoConnectionCredentialCipher(masterKey);
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
  return {
    read() {
      return readForgejoConnection(durableCore);
    },
    /** @param {unknown} input */
    async discover(input) {
      const selected = discoveryRequest(input);
      const verification = await verifier.verify(selected);
      return verification.repositories;
    },
    /** @param {unknown} input */
    async connect(input) {
      const selected = request(input);
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
          read: () => this.read(),
          verifier,
        },
        input,
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
          readConnection: () => this.read(),
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
    destroy() {
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
    async discover() {
      throw error;
    },
    async connect() {
      throw error;
    },
    async rotate() {
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
    destroy() {},
  };
}
