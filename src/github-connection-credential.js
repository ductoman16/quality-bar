import {
  createCipheriv,
  createDecipheriv,
  randomBytes as createRandomBytes,
} from "node:crypto";

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

/**
 * @param {Buffer} masterKey
 * @param {{randomBytes?: (size: number) => Buffer}} [options]
 */
export function createGitHubConnectionCredentialCipher(
  masterKey,
  { randomBytes = createRandomBytes } = {},
) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError("a 32-byte installation master key is required");
  }
  const key = Buffer.from(masterKey);
  return {
    /**
     * @param {{appId: number, id: string}} connection
     * @param {{client_id: string | null, installation_id: number, pem: string}} credential
     */
    encrypt(connection, credential) {
      try {
        const initializationVector = randomBytes(12);
        if (
          !Buffer.isBuffer(initializationVector) ||
          initializationVector.length !== 12
        ) {
          throw new Error("initialization vector is invalid");
        }
        const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
        cipher.setAAD(authenticatedData(connection));
        const ciphertext = Buffer.concat([
          cipher.update(JSON.stringify(credential), "utf8"),
          cipher.final(),
        ]);
        return [
          "v1",
          initializationVector.toString("base64"),
          cipher.getAuthTag().toString("base64"),
          ciphertext.toString("base64"),
        ].join(".");
      } catch (cause) {
        throw Object.assign(
          new Error("GitHub Connection credential could not be encrypted", {
            cause,
          }),
          { code: "github_connection_credential_encryption_unavailable" },
        );
      }
    },
    /**
     * @param {{appId: number, id: string}} connection
     * @param {string} encrypted
     */
    decrypt(connection, encrypted) {
      try {
        const [version, iv, tag, ciphertext, ...extra] = encrypted.split(".");
        if (version !== "v1" || !iv || !tag || !ciphertext || extra.length) {
          throw new Error("credential envelope is invalid");
        }
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(iv, "base64"),
        );
        decipher.setAAD(authenticatedData(connection));
        decipher.setAuthTag(Buffer.from(tag, "base64"));
        const value = /** @type {unknown} */ (
          JSON.parse(
            Buffer.concat([
              decipher.update(Buffer.from(ciphertext, "base64")),
              decipher.final(),
            ]).toString("utf8"),
          )
        );
        if (
          !value ||
          Array.isArray(value) ||
          typeof value !== "object" ||
          Object.keys(value).length !== 3 ||
          !("client_id" in value) ||
          !(
            value.client_id === null ||
            (typeof value.client_id === "string" && value.client_id.length > 0)
          ) ||
          !("installation_id" in value) ||
          !Number.isSafeInteger(value.installation_id) ||
          !("pem" in value) ||
          typeof value.pem !== "string" ||
          value.pem.length === 0
        ) {
          throw new Error("credential plaintext is invalid");
        }
        return {
          client_id: value.client_id,
          installation_id: /** @type {number} */ (value.installation_id),
          pem: value.pem,
        };
      } catch (cause) {
        throw Object.assign(
          new Error("GitHub Connection credential cannot be decrypted", {
            cause,
          }),
          { code: "github_connection_credential_undecryptable" },
        );
      }
    },
    destroy() {
      key.fill(0);
    },
  };
}
