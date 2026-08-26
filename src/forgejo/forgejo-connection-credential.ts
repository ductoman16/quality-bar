import { createCredentialEnvelope } from "../forge/connection/credential-envelope.ts";

const authenticatedData = (id: string) =>
  Buffer.from(`quality-bar-forgejo-connection-credential-v1:${id}`);

export function createForgejoConnectionCredentialCipher(
  masterKey: Buffer,
  { onSecret }: { onSecret?: (secret: string) => unknown } = {},
) {
  if (onSecret !== undefined && typeof onSecret !== "function") {
    throw new TypeError("onSecret must be a function");
  }
  const rememberToken = (token: string) => onSecret?.(token);
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
