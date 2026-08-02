import { resumeForgejoDeliveries } from "./forgejo-delivery-recovery.js";

/** @param {string} code @param {string} message @returns {never} */
function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

/** @param {unknown} input */
function rotationRequest(input) {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    fail(
      "forgejo_connection_rotation_request_invalid",
      "Forgejo PAT rotation request is invalid",
    );
  }
  const value = /** @type {Record<string, unknown>} */ (input);
  if (
    Object.keys(value).length !== 1 ||
    typeof value.token !== "string" ||
    value.token.length === 0
  ) {
    fail(
      "forgejo_connection_rotation_request_invalid",
      "Forgejo PAT rotation request is invalid",
    );
  }
  return { token: value.token };
}

/** @param {any} verification @param {number[]} repositoryIds */
export function verifiedForgejoRepositories(verification, repositoryIds) {
  const verifiedIds = new Set(
    Array.isArray(verification?.repositories)
      ? verification.repositories.map(
          /** @param {any} repository */ (repository) => repository?.id,
        )
      : [],
  );
  if (
    !verification ||
    !Array.isArray(verification.repositories) ||
    verification.repositories.length !== repositoryIds.length ||
    verification.repositories.some(
      /** @param {any} repository */ (repository) =>
        !repository ||
        !Number.isSafeInteger(repository.id) ||
        !repositoryIds.includes(repository.id) ||
        repository.outcome !== "success" ||
        repository.permissions?.admin !== true ||
        repository.permissions?.pull !== true ||
        repository.permissions?.push !== true,
    ) ||
    verifiedIds.size !== repositoryIds.length
  ) {
    fail(
      "forgejo_verification_result_invalid",
      "Forgejo verification result is invalid",
    );
  }
  return verification;
}

/**
 * @param {{cipher: {encrypt: (id: string, token: string) => string}, createId: () => string | undefined, durableCore: any, now: () => number, polling: {commitBaseline: Function, prepareBaseline: Function}, read: () => unknown, registerSecret?: (secret: string) => unknown, verifier: {verify: (input: any) => Promise<any>}}} dependencies
 * @param {unknown} input
 */
export async function rotateForgejoConnection(
  {
    cipher,
    createId,
    durableCore,
    now,
    polling,
    read,
    registerSecret,
    verifier,
  },
  input,
) {
  const selected = rotationRequest(input);
  registerSecret?.(selected.token);
  const [connection] = durableCore.all(
    `SELECT forgejo_connections.*, forgejo_connection_credentials.encrypted_credential
     FROM forgejo_connections
     JOIN forgejo_connection_credentials
       ON forgejo_connection_credentials.connection_id = forgejo_connections.id
     LIMIT 1`,
  );
  if (!connection) {
    fail("forgejo_connection_not_found", "Forgejo Connection was not found");
  }
  if (
    typeof connection.id !== "string" ||
    typeof connection.base_url !== "string" ||
    typeof connection.encrypted_credential !== "string"
  ) {
    throw new TypeError("Forgejo Connection credential row is invalid");
  }
  const activeRepositories = durableCore.all(
    `SELECT forgejo_repositories.forge_repository_id,
            forgejo_repositories.name
       FROM forgejo_repositories
       JOIN repositories ON repositories.id = forgejo_repositories.repository_id
       WHERE forgejo_repositories.connection_id = ?
         AND repositories.lifecycle = 'enabled'
       ORDER BY forgejo_repositories.forge_repository_id`,
    connection.id,
  );
  if (
    activeRepositories.some(
      /** @param {Record<string, unknown> | undefined} repository */ (
        repository,
      ) =>
        !repository ||
        typeof repository.forge_repository_id !== "number" ||
        !Number.isSafeInteger(repository.forge_repository_id) ||
        repository.forge_repository_id <= 0 ||
        typeof repository.name !== "string",
    )
  ) {
    fail(
      "forgejo_connection_repository_invalid",
      "Forgejo Connection dependent Repository is invalid",
    );
  }
  const activeRepositoryIds = /** @type {number[]} */ (
    activeRepositories.map(
      /** @param {Record<string, unknown> | undefined} repository */ (
        repository,
      ) => Number(repository?.forge_repository_id),
    )
  );
  const verificationId = createId();
  const verifiedAt = now();
  if (
    typeof verificationId !== "string" ||
    !verificationId ||
    !Number.isSafeInteger(verifiedAt)
  ) {
    throw new TypeError("Forgejo Connection rotation identity is invalid");
  }
  /** @type {any | undefined} */
  let completedVerification;
  try {
    const verification = verifiedForgejoRepositories(
      await verifier.verify({
        baseUrl: connection.base_url,
        repositoryIds: activeRepositoryIds,
        token: selected.token,
      }),
      activeRepositoryIds,
    );
    if (
      verification.profile !== "forgejo-v16" ||
      !verification.principal ||
      !Number.isSafeInteger(verification.principal.id) ||
      typeof verification.principal.login !== "string" ||
      !Array.isArray(verification.scopes) ||
      !verification.capabilities ||
      Array.isArray(verification.capabilities) ||
      typeof verification.capabilities !== "object" ||
      typeof verification.reported_version !== "string"
    ) {
      fail(
        "forgejo_verification_result_invalid",
        "Forgejo verification result is invalid",
      );
    }
    completedVerification = verification;
    if (
      verification.principal.id !== connection.principal_id ||
      verification.principal.login !== connection.principal_login
    ) {
      fail(
        "forgejo_rotation_identity_mismatch",
        "Replacement Forgejo PAT does not match the configured Connection",
      );
    }
    const preparedBaseline = await polling.prepareBaseline(
      { base_url: connection.base_url, id: connection.id },
      selected.token,
      activeRepositories.map((/** @type {any} */ repository) => ({
        full_name: repository?.name,
        id: repository?.forge_repository_id,
      })),
      { ignoreGate: true },
    );
    const encrypted = cipher.encrypt(connection.id, selected.token);
    durableCore.transaction((/** @type {any} */ transaction) => {
      transaction.run(
        "INSERT INTO forgejo_connection_verifications (id, connection_id, trigger, profile, reported_version, principal, scopes, capabilities, repositories, error_code, error_message, verified_at) VALUES (?, ?, 'rotation', ?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
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
      const replacement = /** @type {{changes: number}} */ (
        transaction.run(
          `UPDATE forgejo_connection_credentials
           SET encrypted_credential = ?, created_at = ?
           WHERE connection_id = ? AND encrypted_credential = ?`,
          encrypted,
          verifiedAt,
          connection.id,
          connection.encrypted_credential,
        )
      );
      if (replacement.changes !== 1) {
        fail(
          "forgejo_connection_rotation_conflict",
          "Forgejo PAT changed during rotation",
        );
      }
      const connectionUpdate = /** @type {{changes: number}} */ (
        transaction.run(
          `UPDATE forgejo_connections
           SET reported_version = ?, scopes = ?, capabilities = ?,
               health = 'healthy', verified_at = ?
           WHERE id = ? AND NOT EXISTS (
             SELECT 1 FROM forgejo_repositories
             JOIN repositories ON repositories.id = forgejo_repositories.repository_id
             WHERE forgejo_repositories.connection_id = ?
               AND repositories.lifecycle = 'enabled'
               AND forgejo_repositories.forge_repository_id NOT IN (${activeRepositoryIds.map(() => "?").join(", ")})
           )`,
          verification.reported_version,
          JSON.stringify(verification.scopes),
          JSON.stringify(verification.capabilities),
          verifiedAt,
          connection.id,
          connection.id,
          ...activeRepositoryIds,
        )
      );
      if (connectionUpdate.changes !== 1) {
        fail(
          "forgejo_connection_rotation_conflict",
          "Forgejo active dependent Repositories changed during rotation",
        );
      }
      for (const repositoryId of activeRepositoryIds) {
        const updated = /** @type {{changes: number}} */ (
          transaction.run(
            `UPDATE forgejo_repositories SET verification_id = ?
             WHERE connection_id = ? AND forge_repository_id = ?`,
            verificationId,
            connection.id,
            repositoryId,
          )
        );
        if (updated.changes !== 1) {
          fail(
            "forgejo_connection_rotation_conflict",
            "Forgejo dependent Repository changed during rotation",
          );
        }
      }
      resumeForgejoDeliveries(
        transaction,
        connection.id,
        verifiedAt,
        "connection_authority",
        activeRepositoryIds,
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
    durableCore.transaction((/** @type {any} */ transaction) => {
      const healthUpdate = /** @type {{changes: number}} */ (
        transaction.run(
          `UPDATE forgejo_connections
           SET health = 'error', verified_at = ?
           WHERE id = ? AND EXISTS (
             SELECT 1
             FROM forgejo_connection_credentials
             WHERE connection_id = ? AND encrypted_credential = ?
           )`,
          verifiedAt,
          connection.id,
          connection.id,
          connection.encrypted_credential,
        )
      );
      if (healthUpdate.changes !== 1) {
        fail(
          "forgejo_connection_rotation_conflict",
          "Forgejo PAT changed during rotation",
        );
      }
      transaction.run(
        "INSERT INTO forgejo_connection_verifications (id, connection_id, trigger, profile, reported_version, principal, scopes, capabilities, repositories, error_code, error_message, verified_at) VALUES (?, ?, 'rotation', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
            activeRepositoryIds.map((repositoryId) => ({
              error: { code: error.code, message: error.message },
              forge_repository_id: repositoryId,
              outcome: "error",
            })),
        ),
        error.code,
        error.message,
        verifiedAt,
      );
    });
    throw error;
  }
  return read();
}
