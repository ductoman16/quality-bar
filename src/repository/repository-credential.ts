import {
  createCipheriv,
  createDecipheriv,
  randomBytes as createRandomBytes,
} from "node:crypto";

import { fail, RepositoryError } from "./repository-validation.ts";

function additionalAuthenticatedData(repository: { id: string; url: string }) {
  return Buffer.from(
    JSON.stringify([
      "quality-bar-repository-credential-v1",
      repository.id,
      repository.url,
    ]),
    "utf8",
  );
}

export function createRepositoryCredentialCipher(
  masterKey: Buffer,
  {
    randomBytes = createRandomBytes,
    onSecret,
  }: {
    randomBytes?: (size: number) => Buffer;
    onSecret?: (secret: string) => unknown;
  } = {},
) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError("a 32-byte installation master key is required");
  }
  if (typeof randomBytes !== "function") {
    throw new TypeError("randomBytes must be a function");
  }
  if (onSecret !== undefined && typeof onSecret !== "function") {
    throw new TypeError("onSecret must be a function");
  }
  const key = Buffer.from(masterKey);

  function rememberCredential(credential: { token: string; username: string }) {
    onSecret?.(credential.token);
    onSecret?.(credential.username);
  }

  return {
    encrypt(
      repository: { id: string; url: string },
      credential: { token: string; username: string },
    ) {
      try {
        rememberCredential(credential);
        const initializationVector = randomBytes(12);
        if (
          !Buffer.isBuffer(initializationVector) ||
          initializationVector.length !== 12
        ) {
          fail(
            "repository_credential_encryption_unavailable",
            "Repository credential could not be encrypted",
          );
        }
        const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
        cipher.setAAD(additionalAuthenticatedData(repository));
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
        if (cause instanceof RepositoryError) {
          throw cause;
        }
        fail(
          "repository_credential_encryption_unavailable",
          "Repository credential could not be encrypted",
          cause,
        );
      }
    },

    decrypt(repository: { id: string; url: string }, encrypted: string) {
      try {
        const [
          version,
          initializationVector,
          authenticationTag,
          ciphertext,
          ...extra
        ] = encrypted.split(".");
        if (
          version !== "v1" ||
          extra.length !== 0 ||
          !initializationVector ||
          !authenticationTag ||
          !ciphertext
        ) {
          throw new Error("credential envelope is invalid");
        }
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(initializationVector, "base64"),
        );
        decipher.setAAD(additionalAuthenticatedData(repository));
        decipher.setAuthTag(Buffer.from(authenticationTag, "base64"));
        const value = JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(ciphertext, "base64")),
            decipher.final(),
          ]).toString("utf8"),
        ) as unknown;
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).length !== 2 ||
          !("token" in value) ||
          typeof value.token !== "string" ||
          value.token.length === 0 ||
          !("username" in value) ||
          typeof value.username !== "string" ||
          value.username.length === 0
        ) {
          throw new Error("credential plaintext is invalid");
        }
        const credential = { token: value.token, username: value.username };
        rememberCredential(credential);
        return credential;
      } catch (cause) {
        fail(
          "repository_credential_undecryptable",
          "Repository credential cannot be decrypted",
          cause,
        );
      }
    },

    destroy() {
      key.fill(0);
    },
  };
}
