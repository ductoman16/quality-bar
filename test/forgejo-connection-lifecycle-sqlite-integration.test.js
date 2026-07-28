import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createForgejoConnectionCredentialCipher } from "../src/forgejo-connection-credential.js";
import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import { openDurableCore } from "../src/durable-core.js";

const repository = {
  api_url: "https://forgejo.example/api/v1/repos/operator/private",
  clone_url: "https://forgejo.example/operator/private.git",
  full_name: "operator/private",
  html_url: "https://forgejo.example/operator/private",
  id: 11,
  private: true,
};

function verified(repositories = [repository]) {
  return {
    capabilities: {
      enumeration: "verified",
      private_git_read:
        repositories.length === 0 ? "not_completed" : "verified",
    },
    principal: { id: 7, login: "operator" },
    profile: "forgejo-v16",
    reported_version: "16.0.4",
    repositories,
    scopes: ["read:repository", "write:issue", "write:repository"],
  };
}

test("SQLite retirement blocks enabled and disabled dependents, then destroys only the PAT", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-retire-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const service = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = ["connection-1", "verification-1", "repository-1"];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 11),
    now: () => 1_000,
    verifier: {
      async verify() {
        return verified();
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "operator-pat",
  });

  for (const lifecycle of ["enabled", "disabled"]) {
    core.run(
      "UPDATE repositories SET lifecycle = ? WHERE id = 'repository-1'",
      lifecycle,
    );
    assert.throws(() => service.retire({ lifecycle: "retired" }), {
      code: "forgejo_connection_repositories_active",
    });
  }
  core.run(
    "UPDATE repositories SET lifecycle = 'retired' WHERE id = 'repository-1'",
  );
  assert.equal(
    /** @type {{lifecycle: string}} */ (
      service.retire({ lifecycle: "retired" })
    ).lifecycle,
    "retired",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_connection_credentials")
      ?.count,
    0,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_connection_verifications")
      ?.count,
    1,
  );
  assert.equal(
    /** @type {{lifecycle: string}} */ (
      service.retire({ lifecycle: "retired" })
    ).lifecycle,
    "retired",
  );
  assert.throws(() => service.remove(), {
    code: "forgejo_connection_delete_unsupported",
  });
  service.destroy();
  core.close();
});

test("SQLite reactivation completely verifies the same Forgejo identity and restores a write-only PAT", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-reactivate-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  /** @type {any[]} */
  const inputs = [];
  let timestamp = 1_000;
  const masterKey = Buffer.alloc(32, 12);
  const service = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "verification-2",
        "verification-3",
        "verification-4",
      ];
      return () => ids.shift();
    })(),
    masterKey,
    now: () => timestamp,
    verifier: {
      async verify(input) {
        inputs.push(input);
        if (input.token === "unavailable-pat") {
          throw Object.assign(new Error("Forgejo verification unavailable"), {
            code: "forgejo_verification_unavailable",
          });
        }
        const result = verified(
          input.repositoryIds.length === 0 ? [] : [repository],
        );
        return input.token === "wrong-principal-pat"
          ? { ...result, principal: { id: 8, login: "other" } }
          : result;
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "original-pat",
  });
  core.run(
    "UPDATE repositories SET lifecycle = 'retired' WHERE id = 'repository-1'",
  );
  service.retire({ lifecycle: "retired" });
  timestamp = 2_000;
  await assert.rejects(() => service.reactivate({ token: "unavailable-pat" }), {
    code: "forgejo_verification_unavailable",
  });
  assert.deepEqual(service.read()?.verification_history.at(-1), {
    api_profile: null,
    capabilities: null,
    error: {
      code: "forgejo_verification_unavailable",
      message: "Forgejo verification unavailable",
    },
    id: "verification-2",
    outcome: "error",
    principal: null,
    reported_version: null,
    repositories: [
      {
        error: {
          code: "forgejo_verification_unavailable",
          message: "Forgejo verification unavailable",
        },
        forge_repository_id: 11,
        outcome: "error",
      },
    ],
    scopes: null,
    trigger: "enablement",
    verified_at: 2_000,
  });
  timestamp = 3_000;
  await assert.rejects(
    () => service.reactivate({ token: "wrong-principal-pat" }),
    { code: "forgejo_reactivation_identity_mismatch" },
  );
  assert.equal(
    /** @type {{lifecycle: string}} */ (service.read()).lifecycle,
    "retired",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_connection_credentials")
      ?.count,
    0,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_connection_verifications")
      ?.count,
    3,
  );
  assert.deepEqual(service.read()?.health_error, {
    code: "forgejo_reactivation_identity_mismatch",
    message: "Replacement Forgejo PAT does not match the retired Connection",
  });
  timestamp = 4_000;

  const reactivated = await service.reactivate({ token: "replacement-pat" });

  assert.equal(
    /** @type {{lifecycle: string}} */ (reactivated).lifecycle,
    "enabled",
  );
  assert.deepEqual(inputs[3], {
    baseUrl: "https://forgejo.example",
    repositoryIds: [11],
    token: "replacement-pat",
  });
  assert.deepEqual(
    core.all(
      "SELECT trigger FROM forgejo_connection_verifications ORDER BY rowid",
    ),
    [
      { trigger: "onboarding" },
      { trigger: "enablement" },
      { trigger: "enablement" },
      { trigger: "enablement" },
    ],
  );
  assert.deepEqual(/** @type {any} */ (reactivated).capabilities, {
    enumeration: "verified",
    private_git_read: "verified",
  });
  assert.equal(/** @type {any} */ (reactivated).verification_history.length, 4);
  const cipher = createForgejoConnectionCredentialCipher(masterKey);
  assert.equal(
    cipher.decrypt(
      "connection-1",
      /** @type {{encrypted_credential: string}} */ (
        core.get(
          "SELECT encrypted_credential FROM forgejo_connection_credentials",
        )
      ).encrypted_credential,
    ),
    "replacement-pat",
  );
  cipher.destroy();
  assert.equal(
    core.get("SELECT lifecycle FROM repositories WHERE id = 'repository-1'")
      ?.lifecycle,
    "retired",
  );
  service.destroy();
  core.close();
});

test("SQLite hard-deletes only a never-used Forgejo Connection", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-delete-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const cipher = createForgejoConnectionCredentialCipher(Buffer.alloc(32, 13));
  core.run(
    "INSERT INTO forgejo_connections (id, base_url, api_profile, reported_version, principal_id, principal_login, scopes, capabilities, health, created_at, verified_at) VALUES ('connection-1', 'https://forgejo.example', 'forgejo-v16', '16.0.4', 7, 'operator', '[]', '{}', 'healthy', 1000, 1000)",
  );
  core.run(
    "INSERT INTO forgejo_connection_credentials (connection_id, encrypted_credential, created_at) VALUES ('connection-1', ?, 1000)",
    cipher.encrypt("connection-1", "operator-pat"),
  );
  core.run(
    "INSERT INTO forgejo_connection_verifications (id, connection_id, trigger, profile, reported_version, principal, scopes, capabilities, repositories, error_code, error_message, verified_at) VALUES ('verification-1', 'connection-1', 'onboarding', 'forgejo-v16', '16.0.4', '{\"id\":7,\"login\":\"operator\"}', '[]', '{}', '[]', NULL, NULL, 1000)",
  );
  cipher.destroy();
  const service = createForgejoConnectionService(core, {
    masterKey: Buffer.alloc(32, 13),
    verifier: {
      async verify() {
        throw new Error("unused");
      },
    },
  });

  assert.throws(() => service.retire({ lifecycle: "retired" }), {
    code: "forgejo_connection_retirement_unsupported",
  });
  service.remove();

  assert.equal(service.read(), null);
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_connection_verifications")
      ?.count,
    0,
  );
  service.destroy();
  core.close();
});
