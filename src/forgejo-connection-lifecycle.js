import { verifiedForgejoRepositories } from "./forgejo-connection-rotation.js";

/** @param {string} code @param {string} message @returns {never} */
function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

/** @param {unknown} input */
function retirementRequest(input) {
  if (
    !input ||
    Array.isArray(input) ||
    typeof input !== "object" ||
    Object.keys(input).length !== 1 ||
    /** @type {Record<string, unknown>} */ (input).lifecycle !== "retired"
  ) {
    fail(
      "forgejo_connection_lifecycle_request_invalid",
      "Forgejo Connection lifecycle request must retire the Connection",
    );
  }
}

/** @param {unknown} input */
function reactivationRequest(input) {
  if (
    !input ||
    Array.isArray(input) ||
    typeof input !== "object" ||
    Object.keys(input).length !== 1 ||
    typeof (/** @type {Record<string, unknown>} */ (input).token) !==
      "string" ||
    /** @type {Record<string, unknown>} */ (input).token === ""
  ) {
    fail(
      "forgejo_connection_reactivation_request_invalid",
      "Forgejo Connection reactivation requires one replacement PAT",
    );
  }
  return /** @type {{token: string}} */ (input);
}

/** @param {any} durableCore @param {unknown} input @param {() => unknown} read */
export function retireForgejoConnection(durableCore, input, read) {
  retirementRequest(input);
  const [connection] = durableCore.all(
    "SELECT id, lifecycle FROM forgejo_connections LIMIT 1",
  );
  if (!connection) {
    fail("forgejo_connection_not_found", "Forgejo Connection was not found");
  }
  if (connection.lifecycle === "retired") {
    return read();
  }
  const dependents = durableCore.all(
    `SELECT repositories.id
     FROM forgejo_repositories
     JOIN repositories ON repositories.id = forgejo_repositories.repository_id
     WHERE forgejo_repositories.connection_id = ?
       AND repositories.lifecycle != 'retired'`,
    connection.id,
  );
  if (dependents.length) {
    fail(
      "forgejo_connection_repositories_active",
      "Forgejo Connection cannot retire while dependent Repositories are enabled or disabled",
    );
  }
  durableCore.transaction((/** @type {any} */ transaction) => {
    const credential = transaction.run(
      "DELETE FROM forgejo_connection_credentials WHERE connection_id = ?",
      connection.id,
    );
    const retired = transaction.run(
      `UPDATE forgejo_connections
       SET lifecycle = 'retired'
       WHERE id = ? AND lifecycle = 'enabled'
         AND NOT EXISTS (
           SELECT 1
           FROM forgejo_repositories
           JOIN repositories
             ON repositories.id = forgejo_repositories.repository_id
           WHERE forgejo_repositories.connection_id = ?
             AND repositories.lifecycle != 'retired'
         )`,
      connection.id,
      connection.id,
    );
    if (credential.changes !== 1 || retired.changes !== 1) {
      fail(
        "forgejo_connection_lifecycle_conflict",
        "Forgejo Connection changed during retirement",
      );
    }
  });
  return read();
}

/** @param {any} durableCore */
export function removeNeverUsedForgejoConnection(durableCore) {
  const [connection] = durableCore.all(
    "SELECT id FROM forgejo_connections LIMIT 1",
  );
  if (!connection) {
    fail("forgejo_connection_not_found", "Forgejo Connection was not found");
  }
  if (
    durableCore.all(
      "SELECT repository_id FROM forgejo_repositories WHERE connection_id = ? LIMIT 1",
      connection.id,
    ).length
  ) {
    fail(
      "forgejo_connection_delete_unsupported",
      "Forgejo Connection with dependent Repositories must be retired",
    );
  }
  durableCore.transaction((/** @type {any} */ transaction) => {
    transaction.run(
      "INSERT INTO quality_bar_metadata (key, value) VALUES ('forgejo_connection_delete', ?)",
      connection.id,
    );
    transaction.run(
      "DELETE FROM forgejo_connection_verifications WHERE connection_id = ?",
      connection.id,
    );
    transaction.run(
      "DELETE FROM forgejo_connection_credentials WHERE connection_id = ?",
      connection.id,
    );
    const removed = transaction.run(
      "DELETE FROM forgejo_connections WHERE id = ?",
      connection.id,
    );
    if (removed.changes !== 1) {
      fail(
        "forgejo_connection_lifecycle_conflict",
        "Forgejo Connection changed during deletion",
      );
    }
    transaction.run(
      "DELETE FROM quality_bar_metadata WHERE key = 'forgejo_connection_delete'",
    );
  });
}

/**
 * @param {{cipher: {encrypt: (id: string, token: string) => string}, createId: () => string | undefined, durableCore: any, now: () => number, read: () => unknown, verifier: {verify: (input: any) => Promise<any>}}} dependencies
 * @param {unknown} input
 */
export async function reactivateForgejoConnection(
  { cipher, createId, durableCore, now, read, verifier },
  input,
) {
  const { token } = reactivationRequest(input);
  const [connection] = durableCore.all(
    `SELECT id, base_url, lifecycle, principal_id, principal_login
     FROM forgejo_connections LIMIT 1`,
  );
  if (!connection) {
    fail("forgejo_connection_not_found", "Forgejo Connection was not found");
  }
  if (connection.lifecycle !== "retired") {
    fail(
      "forgejo_connection_reactivation_unsupported",
      "Forgejo Connection must be retired before reactivation",
    );
  }
  const verificationId = createId();
  const verifiedAt = now();
  if (
    typeof verificationId !== "string" ||
    !verificationId ||
    !Number.isSafeInteger(verifiedAt)
  ) {
    throw new TypeError("Forgejo Connection reactivation identity is invalid");
  }
  const verification = verifiedForgejoRepositories(
    await verifier.verify({
      baseUrl: connection.base_url,
      repositoryIds: [],
      token,
    }),
    [],
  );
  if (
    verification.profile !== "forgejo-v16" ||
    verification.principal?.id !== connection.principal_id ||
    verification.principal?.login !== connection.principal_login
  ) {
    fail(
      "forgejo_reactivation_identity_mismatch",
      "Replacement Forgejo PAT does not match the retired Connection",
    );
  }
  const encrypted = cipher.encrypt(connection.id, token);
  durableCore.transaction((/** @type {any} */ transaction) => {
    transaction.run(
      "INSERT INTO forgejo_connection_verifications (id, connection_id, trigger, profile, reported_version, principal, scopes, capabilities, repositories, error_code, error_message, verified_at) VALUES (?, ?, 'enablement', ?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
      verificationId,
      connection.id,
      verification.profile,
      verification.reported_version,
      JSON.stringify(verification.principal),
      JSON.stringify(verification.scopes),
      JSON.stringify(verification.capabilities),
      JSON.stringify(verification.repositories),
      verifiedAt,
    );
    const credential = transaction.run(
      `INSERT INTO forgejo_connection_credentials
         (connection_id, encrypted_credential, created_at)
       SELECT id, ?, ? FROM forgejo_connections
       WHERE id = ? AND lifecycle = 'retired'
         AND NOT EXISTS (
           SELECT 1 FROM forgejo_connection_credentials
           WHERE connection_id = ?
         )`,
      encrypted,
      verifiedAt,
      connection.id,
      connection.id,
    );
    const reactivated = transaction.run(
      `UPDATE forgejo_connections
       SET lifecycle = 'enabled', reported_version = ?, scopes = ?,
           capabilities = ?, health = 'healthy', verified_at = ?
       WHERE id = ? AND lifecycle = 'retired'`,
      verification.reported_version,
      JSON.stringify(verification.scopes),
      JSON.stringify(verification.capabilities),
      verifiedAt,
      connection.id,
    );
    if (credential.changes !== 1 || reactivated.changes !== 1) {
      fail(
        "forgejo_connection_reactivation_conflict",
        "Forgejo Connection changed during reactivation",
      );
    }
  });
  return read();
}
