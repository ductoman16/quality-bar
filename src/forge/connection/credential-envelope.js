import {
  createCipheriv,
  createDecipheriv,
  randomBytes as defaultRandomBytes,
} from "node:crypto";

/**
 * Shared AES-256-GCM credential envelope used by every forge Connection.
 *
 * The envelope shape is the same across forges — a dotted, base64-encoded
 * `v1.iv.tag.ciphertext` string sealed with AES-256-GCM using a 12-byte IV.
 * Per-forge modules only supply the additional authenticated data (AAD) they
 * bind the envelope to, the payload serializer, the encryption/decryption
 * error codes, and any post-decode validation of the recovered plaintext.
 *
 * @template Context
 * @template Payload
 * @param {{
 *   masterKey: Buffer,
 *   buildAad: (context: Context) => Buffer,
 *   serialize: (payload: Payload) => string,
 *   deserialize: (plaintext: string) => Payload,
 *   errorCodes: {encryption: string, decryption: string},
 *   errorMessages: {encryption: string, decryption: string},
 *   onEncrypt?: (payload: Payload) => void,
 *   onDecrypt?: (payload: Payload) => void,
 *   randomBytes?: (size: number) => Buffer,
 * }} dependencies
 */
export function createCredentialEnvelope({
  masterKey,
  buildAad,
  serialize,
  deserialize,
  errorCodes,
  errorMessages,
  onEncrypt,
  onDecrypt,
  randomBytes = defaultRandomBytes,
}) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError("a 32-byte installation master key is required");
  }
  if (
    typeof buildAad !== "function" ||
    typeof serialize !== "function" ||
    typeof deserialize !== "function"
  ) {
    throw new TypeError("credential envelope dependencies are invalid");
  }
  const key = Buffer.from(masterKey);
  return {
    /**
     * @param {Context} context
     * @param {Payload} payload
     * @returns {string}
     */
    encrypt(context, payload) {
      try {
        onEncrypt?.(payload);
        const iv = randomBytes(12);
        if (!Buffer.isBuffer(iv) || iv.length !== 12) {
          throw new Error("initialization vector is invalid");
        }
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(buildAad(context));
        const ciphertext = Buffer.concat([
          cipher.update(serialize(payload), "utf8"),
          cipher.final(),
        ]);
        return [
          "v1",
          iv.toString("base64"),
          cipher.getAuthTag().toString("base64"),
          ciphertext.toString("base64"),
        ].join(".");
      } catch (cause) {
        throw Object.assign(new Error(errorMessages.encryption, { cause }), {
          code: errorCodes.encryption,
        });
      }
    },
    /**
     * @param {Context} context
     * @param {string} encrypted
     * @returns {Payload}
     */
    decrypt(context, encrypted) {
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
        decipher.setAAD(buildAad(context));
        decipher.setAuthTag(Buffer.from(tag, "base64"));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(ciphertext, "base64")),
          decipher.final(),
        ]).toString("utf8");
        const payload = deserialize(plaintext);
        onDecrypt?.(payload);
        return payload;
      } catch (cause) {
        throw Object.assign(new Error(errorMessages.decryption, { cause }), {
          code: errorCodes.decryption,
        });
      }
    },
    destroy() {
      key.fill(0);
    },
  };
}
