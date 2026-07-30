import assert from "node:assert/strict";
import test from "node:test";

import { createRepositoryGitCredentialAcquirer } from "../src/repository-git-credential.js";

test("execution acquisition resolves only the owning Repository credential", async () => {
  const genericCredential = { token: "generic-token", username: "operator" };
  const acquireGeneric = createRepositoryGitCredentialAcquirer({
    credentialCipher: {
      decrypt(identity, encrypted) {
        assert.deepEqual(identity, {
          id: "repository-1",
          url: "https://example.test/repository.git",
        });
        assert.equal(encrypted, "ciphertext");
        return genericCredential;
      },
    },
    find: () => ({ encrypted_credential: "ciphertext" }),
    readRepository: () => ({
      id: "repository-1",
      url: "https://example.test/repository.git",
    }),
  });
  assert.equal(await acquireGeneric("repository-1"), genericCredential);

  const forgeCredential = { token: "forge-token", username: "x-access-token" };
  const acquireForge = createRepositoryGitCredentialAcquirer({
    credentialCipher: { decrypt: assert.fail },
    find: () => ({}),
    readRepository: () => ({
      forge_connection_id: "connection-1",
      provider: "github",
    }),
    resolveForgeCredential(connectionId, provider) {
      assert.equal(connectionId, "connection-1");
      assert.equal(provider, "github");
      return forgeCredential;
    },
  });
  assert.equal(await acquireForge("repository-2"), forgeCredential);
});

test("execution credential resolution preserves the Forge owner failure", async () => {
  const failure = Object.assign(new Error("credential failed exactly"), {
    code: "github_credential_failed",
  });
  const acquire = createRepositoryGitCredentialAcquirer({
    credentialCipher: { decrypt: assert.fail },
    find: () => ({}),
    readRepository: () => ({
      forge_connection_id: "connection-1",
      provider: "github",
    }),
    resolveForgeCredential() {
      throw failure;
    },
  });
  await assert.rejects(
    acquire("repository-1"),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === failure.code &&
      error.message === failure.message &&
      error.cause === failure,
  );
});
