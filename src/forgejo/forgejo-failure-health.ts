export function updateForgejoConnectionFailureHealth(
  transaction: any,
  connectionId: string,
  scope: "connection" | "repository" | null,
  verifiedAt: number,
) {
  return transaction.run(
    `UPDATE forgejo_connections
     SET health = CASE WHEN ? = 'connection' THEN 'error' ELSE health END,
         verified_at = CASE WHEN ? = 'connection' THEN ? ELSE verified_at END
     WHERE id = ? AND lifecycle = 'enabled'`,
    scope,
    scope,
    verifiedAt,
    connectionId,
  );
}

export function commitForgejoReactivationFailure(
  transaction: any,
  input: {
    completedVerification: any;
    connectionId: string;
    error: Error & {
      code: string;
      repositoryId?: number;
      repositoryIds?: number[];
    };
    failedVerification: any;
    repositoryIds: number[];
    scope: "connection" | "repository" | null;
    verificationId: string;
    verifiedAt: number;
  },
) {
  const healthUpdate = transaction.run(
    `UPDATE forgejo_connections
     SET health = CASE WHEN ? = 'connection' THEN 'error' ELSE health END,
         verified_at = CASE WHEN ? = 'connection' THEN ? ELSE verified_at END
     WHERE id = ? AND lifecycle = 'retired'
       AND NOT EXISTS (
         SELECT 1 FROM forgejo_connection_credentials WHERE connection_id = ?
       )`,
    input.scope,
    input.scope,
    input.verifiedAt,
    input.connectionId,
    input.connectionId,
  );
  if (healthUpdate.changes !== 1) {
    reactivationConflict("Forgejo Connection changed during reactivation");
  }
  const evidence = input.failedVerification ?? input.completedVerification;
  transaction.run(
    "INSERT INTO forgejo_connection_verifications (id, connection_id, trigger, profile, reported_version, principal, scopes, capabilities, repositories, error_code, error_message, verified_at) VALUES (?, ?, 'enablement', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    input.verificationId,
    input.connectionId,
    input.failedVerification?.profile ??
      input.completedVerification?.profile ??
      null,
    input.failedVerification?.reported_version ??
      input.completedVerification?.reported_version ??
      null,
    evidence ? JSON.stringify(evidence.principal) : null,
    evidence ? JSON.stringify(evidence.scopes) : null,
    evidence ? JSON.stringify(evidence.capabilities) : null,
    JSON.stringify(
      evidence?.repositories ??
        failedForgejoRepositoryChecks(input.error, input.repositoryIds),
    ),
    input.error.code,
    input.error.message,
    input.verifiedAt,
  );
  for (const repositoryId of input.scope === "repository"
    ? forgejoFailureRepositoryIds(input.error)
    : []) {
    if (
      !commitForgejoRepositoryFailure(
        transaction,
        input.error,
        input.connectionId,
        repositoryId,
        input.verificationId,
        input.verifiedAt,
      )
    ) {
      reactivationConflict(
        "Forgejo Repository mapping changed during reactivation",
      );
    }
  }
}

function reactivationConflict(message: string): never {
  throw Object.assign(new Error(message), {
    code: "forgejo_connection_reactivation_conflict",
  });
}
import { failedForgejoRepositoryChecks } from "./forgejo-repository-check.ts";
import { commitForgejoRepositoryFailure } from "./forgejo-repository-failure-commit.ts";
import { forgejoFailureRepositoryIds } from "./forgejo-failure.ts";
