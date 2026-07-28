import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** @param {Buffer} masterKey */
export function createForgejoConnectionCredentialCipher(masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError("a 32-byte installation master key is required");
  }
  const key = Buffer.from(masterKey);
  /** @param {string} id */
  const aad = (id) =>
    Buffer.from(`quality-bar-forgejo-connection-credential-v1:${id}`);
  return {
    /** @param {string} id @param {string} token */
    encrypt(id, token) {
      try {
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(aad(id));
        const ciphertext = Buffer.concat([
          cipher.update(token, "utf8"),
          cipher.final(),
        ]);
        return [
          "v1",
          iv.toString("base64"),
          cipher.getAuthTag().toString("base64"),
          ciphertext.toString("base64"),
        ].join(".");
      } catch (cause) {
        throw Object.assign(
          new Error("Forgejo PAT could not be encrypted", { cause }),
          { code: "forgejo_credential_encryption_unavailable" },
        );
      }
    },
    /** @param {string} id @param {string} encrypted */
    decrypt(id, encrypted) {
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
        decipher.setAAD(aad(id));
        decipher.setAuthTag(Buffer.from(tag, "base64"));
        const token = Buffer.concat([
          decipher.update(Buffer.from(ciphertext, "base64")),
          decipher.final(),
        ]).toString("utf8");
        if (!token) {
          throw new Error("credential plaintext is invalid");
        }
        return token;
      } catch (cause) {
        throw Object.assign(
          new Error("Forgejo PAT cannot be decrypted", { cause }),
          { code: "forgejo_credential_undecryptable" },
        );
      }
    },
    destroy() {
      key.fill(0);
    },
  };
}
