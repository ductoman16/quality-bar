import assert from "node:assert/strict";
import { test } from "node:test";

import { createRepositoryCredentialCipher } from "../src/repository-credential.js";
import { RepositoryError } from "../src/repository-validation.js";

const masterKey = Buffer.alloc(32, 7);
const repository = {
  id: "repository-1",
  url: "https://example.com/private.git",
};
const credential = {
  token: "private-token-value",
  username: "operator",
};

test("a Repository-bound username and token use authenticated encryption under the installation master key", () => {
  const cipher = createRepositoryCredentialCipher(masterKey, {
    randomBytes: () => Buffer.alloc(12, 3),
  });
  const encrypted = cipher.encrypt(repository, credential);

  assert.match(encrypted, /^v1\./);
  assert.doesNotMatch(encrypted, /operator|private-token-value/);
  assert.deepEqual(cipher.decrypt(repository, encrypted), credential);

  const wrongKeyCipher = createRepositoryCredentialCipher(Buffer.alloc(32, 8));
  assert.throws(
    () => wrongKeyCipher.decrypt(repository, encrypted),
    (error) => {
      assert.ok(error instanceof RepositoryError);
      assert.equal(error.code, "repository_credential_undecryptable");
      assert.doesNotMatch(error.message, /operator|private-token-value/);
      return true;
    },
  );
});

test("encrypted credentials cannot be moved to a different Repository identity", () => {
  const cipher = createRepositoryCredentialCipher(masterKey, {
    randomBytes: () => Buffer.alloc(12, 4),
  });
  const encrypted = cipher.encrypt(repository, credential);

  assert.throws(
    () =>
      cipher.decrypt(
        { id: "repository-2", url: "https://example.com/other.git" },
        encrypted,
      ),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_credential_undecryptable",
  );
});
