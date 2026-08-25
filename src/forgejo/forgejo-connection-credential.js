import { createCredentialEnvelope } from "../forge/connection/credential-envelope.js";

/** @param {string} id */
const authenticatedData = (id) =>
  Buffer.from(`quality-bar-forgejo-connection-credential-v1:${id}`);

/** @param {Buffer} masterKey @param {{onSecret?: (secret: string) => unknown}} [options] */
export function createForgejoConnectionCredentialCipher(
  masterKey,
  { onSecret } = {},
) {
  if (onSecret !== undefined && typeof onSecret !== "function") {
    throw new TypeError("onSecret must be a function");
  }
  /** @param {string} token */
  const rememberToken = (token) => onSecret?.(token);
  return createCredentialEnvelope({
    buildAad: authenticatedData,
    deserialize: (plaintext) => {
      if (!plaintext) {
        throw new Error("credential plaintext is invalid");
      }
      return plaintext;
    },
    errorCodes: {
      decryption: "forgejo_credential_undecryptable",
      encryption: "forgejo_credential_encryption_unavailable",
    },
    errorMessages: {
      decryption: "Forgejo PAT cannot be decrypted",
      encryption: "Forgejo PAT could not be encrypted",
    },
    masterKey,
    onDecrypt: rememberToken,
    onEncrypt: rememberToken,
    serialize: (token) => token,
  });
}
