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

/**
 * @param {any} durableCore
 * @param {unknown} input
 * @param {() => unknown} readConnection
 */
export function retireForgejoConnection(durableCore, input, readConnection) {
  retirementRequest(input);
  const [connection] = durableCore.all(
    "SELECT id, lifecycle FROM forgejo_connections LIMIT 1",
  );
  if (!connection) {
    fail("forgejo_connection_not_found", "Forgejo Connection was not found");
  }
  if (connection.lifecycle === "retired") {
    return readConnection();
  }
  const dependents = durableCore.all(
    `SELECT repositories.id
     FROM forgejo_repositories
     JOIN repositories ON repositories.id = forgejo_repositories.repository_id
     WHERE forgejo_repositories.connection_id = ?`,
    connection.id,
  );
  if (dependents.length === 0) {
    fail(
      "forgejo_connection_retirement_unsupported",
      "A never-used Forgejo Connection must be deleted",
    );
  }
  if (
    dependents.some(
      /** @param {Record<string, unknown> | undefined} dependent */
      (dependent) =>
        !dependent ||
        typeof dependent.id !== "string" ||
        dependent.id.length === 0,
    )
  ) {
    throw new TypeError("Forgejo Connection dependent Repository is invalid");
  }
  if (
    durableCore.all(
      `SELECT repositories.id
       FROM forgejo_repositories
       JOIN repositories ON repositories.id = forgejo_repositories.repository_id
       WHERE forgejo_repositories.connection_id = ?
         AND repositories.lifecycle != 'retired'`,
      connection.id,
    ).length
  ) {
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
  return readConnection();
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
 * @param {{cipher: {encrypt: (id: string, token: string) => string}, createId: () => string | undefined, durableCore: any, now: () => number, readConnection: () => unknown, verifier: {verify: (input: any) => Promise<any>}}} dependencies
 * @param {unknown} input
 */
export async function reactivateForgejoConnection(
  { cipher, createId, durableCore, now, readConnection, verifier },
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
  const dependentRepositories = durableCore.all(
    `SELECT forgejo_repositories.forge_repository_id
     FROM forgejo_repositories
     JOIN repositories ON repositories.id = forgejo_repositories.repository_id
     WHERE forgejo_repositories.connection_id = ?
       AND repositories.lifecycle = 'retired'
     ORDER BY forgejo_repositories.forge_repository_id`,
    connection.id,
  );
  if (
    dependentRepositories.length === 0 ||
    dependentRepositories.some(
      /** @param {Record<string, unknown> | undefined} repository */
      (repository) =>
        !repository ||
        !Number.isSafeInteger(repository.forge_repository_id) ||
        Number(repository.forge_repository_id) <= 0,
    )
  ) {
    throw new TypeError("Retired Forgejo Connection dependents are invalid");
  }
  const repositoryIds = dependentRepositories.map(
    /** @param {Record<string, unknown> | undefined} repository */
    (repository) => Number(repository?.forge_repository_id),
  );
  const verificationId = createId();
  const verifiedAt = now();
  if (
    typeof verificationId !== "string" ||
    !verificationId ||
    !Number.isSafeInteger(verifiedAt)
  ) {
    throw new TypeError("Forgejo Connection reactivation identity is invalid");
  }
  /** @type {any | undefined} */
  let completedVerification;
  try {
    const verification = verifiedForgejoRepositories(
      await verifier.verify({
        baseUrl: connection.base_url,
        repositoryIds,
        token,
      }),
      repositoryIds,
    );
    completedVerification = verification;
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
         WHERE id = ? AND lifecycle = 'retired'
           AND NOT EXISTS (
             SELECT 1
             FROM forgejo_repositories
             JOIN repositories
               ON repositories.id = forgejo_repositories.repository_id
             WHERE forgejo_repositories.connection_id = ?
               AND repositories.lifecycle != 'retired'
           )`,
        verification.reported_version,
        JSON.stringify(verification.scopes),
        JSON.stringify(verification.capabilities),
        verifiedAt,
        connection.id,
        connection.id,
      );
      if (credential.changes !== 1 || reactivated.changes !== 1) {
        fail(
          "forgejo_connection_reactivation_conflict",
          "Forgejo Connection changed during reactivation",
        );
      }
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      typeof error.code !== "string"
    ) {
      throw error;
    }
    durableCore.transaction((/** @type {any} */ transaction) => {
      const healthUpdate = transaction.run(
        `UPDATE forgejo_connections
         SET health = 'error', verified_at = ?
         WHERE id = ? AND lifecycle = 'retired'
           AND NOT EXISTS (
             SELECT 1 FROM forgejo_connection_credentials
             WHERE connection_id = ?
           )`,
        verifiedAt,
        connection.id,
        connection.id,
      );
      if (healthUpdate.changes !== 1) {
        fail(
          "forgejo_connection_reactivation_conflict",
          "Forgejo Connection changed during reactivation",
        );
      }
      transaction.run(
        "INSERT INTO forgejo_connection_verifications (id, connection_id, trigger, profile, reported_version, principal, scopes, capabilities, repositories, error_code, error_message, verified_at) VALUES (?, ?, 'enablement', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        verificationId,
        connection.id,
        completedVerification?.profile ?? null,
        completedVerification?.reported_version ?? null,
        completedVerification
          ? JSON.stringify(completedVerification.principal)
          : null,
        completedVerification
          ? JSON.stringify(completedVerification.scopes)
          : null,
        completedVerification
          ? JSON.stringify(completedVerification.capabilities)
          : null,
        JSON.stringify(
          completedVerification?.repositories ??
            repositoryIds.map(
              /** @param {number} repositoryId */ (repositoryId) => ({
                error: { code: error.code, message: error.message },
                forge_repository_id: repositoryId,
                outcome: "error",
              }),
            ),
        ),
        error.code,
        error.message,
        verifiedAt,
      );
    });
    throw error;
  }
  return readConnection();
}
