import {
  completeForgejoReactivationVerification,
  failedForgejoReactivationVerification,
} from "./forgejo-connection-reactivation-verification.js";
import { retireForgejoPublicationRows } from "./forgejo-publication-retirement.js";
import { forgejoDefinitiveFailureScope } from "./forgejo-failure.js";
import { commitForgejoReactivationFailure } from "./forgejo-failure-health.js";
import { resumeForgejoDeliveries } from "./forgejo-delivery-recovery.js";

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
    retireForgejoPublicationRows(transaction, connection.id);
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
 * @param {{cipher: {encrypt: (id: string, token: string) => string}, createId: () => string | undefined, durableCore: any, now: () => number, polling: {commitBaseline: (transaction: any, connectionId: string, prepared: any) => void, prepareBaseline: (connection: any, token: string, repositories: any[], options?: {ignoreGate?: boolean}) => Promise<any>}, readConnection: () => unknown, registerSecret?: (secret: string) => unknown, verifier: {verify: (input: any) => Promise<any>}}} dependencies
 * @param {unknown} input
 */
export async function reactivateForgejoConnection(
  {
    cipher,
    createId,
    durableCore,
    now,
    polling,
    readConnection,
    registerSecret,
    verifier,
  },
  input,
) {
  const { token } = reactivationRequest(input);
  registerSecret?.(token);
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
    const verification = completeForgejoReactivationVerification(
      await verifier.verify({
        baseUrl: connection.base_url,
        repositoryIds,
        token,
      }),
      repositoryIds,
    );
    completedVerification = verification;
    if (
      verification.profile !== "forgejo" ||
      verification.principal?.id !== connection.principal_id ||
      verification.principal?.login !== connection.principal_login
    ) {
      fail(
        "forgejo_reactivation_identity_mismatch",
        "Replacement Forgejo PAT does not match the retired Connection",
      );
    }
    const preparedBaseline = await polling.prepareBaseline(
      { base_url: connection.base_url, id: connection.id },
      token,
      verification.repositories.map((/** @type {any} */ repository) => ({
        full_name: repository.full_name,
        id: repository.id,
      })),
      { ignoreGate: true },
    );
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
      resumeForgejoDeliveries(
        transaction,
        connection.id,
        verifiedAt,
        "connection_reactivation",
      );
      polling.commitBaseline(transaction, connection.id, preparedBaseline);
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      typeof error.code !== "string"
    ) {
      throw error;
    }
    const failure =
      /** @type {Error & {code: string, repositoryId?: number, repositoryIds?: number[]}} */ (
        error
      );
    const failedVerification = failedForgejoReactivationVerification(
      error,
      repositoryIds,
    );
    const scope = forgejoDefinitiveFailureScope(failure);
    durableCore.transaction((/** @type {any} */ transaction) => {
      commitForgejoReactivationFailure(transaction, {
        completedVerification,
        connectionId: connection.id,
        error: failure,
        failedVerification,
        repositoryIds,
        scope,
        verificationId,
        verifiedAt,
      });
    });
    throw error;
  }
  return readConnection();
}
