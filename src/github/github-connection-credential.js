import { randomBytes as createRandomBytes } from "node:crypto";
import { createCredentialEnvelope } from "../forge/connection/credential-envelope.js";

/** @param {{appId: number, id: string}} connection */
function authenticatedData(connection) {
  return Buffer.from(
    JSON.stringify([
      "quality-bar-github-connection-credential-v1",
      connection.id,
      connection.appId,
    ]),
  );
}

/** @typedef {{client_id: string | null, installation_id: number, pem: string}} GitHubCredentialPayload */

/** @param {GitHubCredentialPayload} credential */
function validateCredential(credential) {
  if (
    !credential ||
    Array.isArray(credential) ||
    typeof credential !== "object" ||
    Object.keys(credential).length !== 3 ||
    !("client_id" in credential) ||
    !(
      credential.client_id === null ||
      (typeof credential.client_id === "string" &&
        credential.client_id.length > 0)
    ) ||
    !("installation_id" in credential) ||
    !Number.isSafeInteger(credential.installation_id) ||
    !("pem" in credential) ||
    typeof credential.pem !== "string" ||
    credential.pem.length === 0
  ) {
    throw new Error("credential plaintext is invalid");
  }
  return {
    client_id: credential.client_id,
    installation_id: credential.installation_id,
    pem: credential.pem,
  };
}

/**
 * @param {Buffer} masterKey
 * @param {{randomBytes?: (size: number) => Buffer, onSecret?: (secret: string) => unknown}} [options]
 */
export function createGitHubConnectionCredentialCipher(
  masterKey,
  { randomBytes = createRandomBytes, onSecret } = {},
) {
  if (onSecret !== undefined && typeof onSecret !== "function") {
    throw new TypeError("onSecret must be a function");
  }
  /** @param {GitHubCredentialPayload} credential */
  const rememberCredential = (credential) => {
    if (credential.client_id !== null) {
      onSecret?.(credential.client_id);
    }
    onSecret?.(credential.pem);
  };
  const envelope = createCredentialEnvelope({
    buildAad: authenticatedData,
    deserialize: (plaintext) => validateCredential(JSON.parse(plaintext)),
    errorCodes: {
      decryption: "github_connection_credential_undecryptable",
      encryption: "github_connection_credential_encryption_unavailable",
    },
    errorMessages: {
      decryption: "GitHub Connection credential cannot be decrypted",
      encryption: "GitHub Connection credential could not be encrypted",
    },
    masterKey,
    onDecrypt: rememberCredential,
    onEncrypt: rememberCredential,
    randomBytes,
    serialize: (credential) => JSON.stringify(credential),
  });
  return envelope;
}

/**
 * @param {any} durableCore
 * @param {{decrypt: (connection: {appId: number, id: string}, encrypted: string) => unknown, destroy: () => unknown}} cipher
 */
export function validatePersistedGitHubCredentials(durableCore, cipher) {
  try {
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
        throw new TypeError("GitHub Connection credential row is invalid");
      }
      cipher.decrypt(
        { appId: /** @type {number} */ (row.app_id), id: row.id },
        row.encrypted_credential,
      );
    }
  } catch (error) {
    cipher.destroy();
    throw error;
  }
}
