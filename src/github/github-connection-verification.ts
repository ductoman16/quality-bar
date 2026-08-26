export function recordGitHubConnectionVerification(
  durableCore: {
    transaction<Result>(
      callback: (transaction: {
        run(
          sql: string,
          ...parameters: import("node:sqlite").SQLInputValue[]
        ): import("node:sqlite").StatementResultingChanges;
      }) => Result,
    ): Result;
  },
  input: {
    affectedRepositoryIds: number[];
    capabilities: object | null;
    completedRepositoryIds?: number[];
    createId: () => string | undefined;
    error?: {
      code: string;
      message: string;
      repositoryId?: number;
      scope: "connection" | "repository";
    };
    evidence: unknown[];
    id: string;
    permissions: object | null;
    principal: { id: number; login: string } | null;
    profile: string | null;
    repositoryCount?: number;
    timestamp: () => number;
    trigger: "enablement" | "repository_selection" | "rotation";
  },
  { defer = false }: { defer?: boolean } = {},
) {
  const verificationId = input.createId();
  const verifiedAt = input.timestamp();
  const affectedIds = new Set(input.affectedRepositoryIds);
  const completedIds = new Set(input.completedRepositoryIds ?? []);
  const evidenceIds = new Set(
    input.evidence.map((repository) =>
      repository &&
      typeof repository === "object" &&
      "id" in repository &&
      Number.isSafeInteger(repository.id)
        ? repository.id
        : null,
    ),
  );
  if (
    typeof verificationId !== "string" ||
    verificationId.length === 0 ||
    !Number.isSafeInteger(verifiedAt) ||
    affectedIds.size !== input.affectedRepositoryIds.length ||
    [...affectedIds].some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new TypeError("GitHub Connection verification identity is invalid");
  }
  if (
    input.affectedRepositoryIds.length === 0 ||
    completedIds.size !== (input.completedRepositoryIds ?? []).length ||
    [...completedIds].some((id) => !affectedIds.has(id)) ||
    (input.error?.scope === "repository" &&
      (!Number.isSafeInteger(input.error.repositoryId) ||
        !affectedIds.has(input.error.repositoryId as number) ||
        completedIds.has(input.error.repositoryId as number)))
  ) {
    throw new TypeError("GitHub Repository verification scope is invalid");
  }
  if (
    completedIds.size > 0 &&
    (!input.profile ||
      !input.principal ||
      !input.permissions ||
      !input.capabilities ||
      input.evidence.length === 0 ||
      [...completedIds].some((id) => !evidenceIds.has(id)))
  ) {
    throw new TypeError("Completed GitHub Repository evidence is incomplete");
  }
  if (
    !input.error &&
    (!input.profile ||
      !input.principal ||
      !input.permissions ||
      !input.capabilities ||
      input.evidence.length === 0)
  ) {
    throw new TypeError(
      "Successful GitHub verification evidence is incomplete",
    );
  }
  const errorCode = input.error?.code ?? null;
  const errorMessage = input.error?.message ?? null;
  const errorRepositoryId = input.error?.repositoryId ?? null;
  const outcome = input.error ? "error" : "success";
  const repositoryChecks = input.affectedRepositoryIds.map((repositoryId) => ({
    outcome: !input.error
      ? "success"
      : completedIds.has(repositoryId)
        ? "success"
        : repositoryId === errorRepositoryId
          ? "error"
          : "not_completed",
    repository_id: repositoryId,
  }));
  const commit = (transaction: {
    run(
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ): import("node:sqlite").StatementResultingChanges;
  }) => {
    if (!input.error) {
      transaction.run(
        `UPDATE github_connections
         SET health = 'healthy',
             health_error_code = NULL,
             health_error_message = NULL,
             repository_count = ?,
             verified_at = ?
         WHERE id = ?`,
        input.repositoryCount ?? input.evidence.length,
        verifiedAt,
        input.id,
      );
    } else if (input.error.scope === "connection") {
      transaction.run(
        `UPDATE github_connections
         SET health = 'error',
             health_error_code = ?,
             health_error_message = ?,
             verified_at = ?
         WHERE id = ?`,
        errorCode,
        errorMessage,
        verifiedAt,
        input.id,
      );
    } else {
      transaction.run(
        `UPDATE github_connections
         SET health = 'healthy',
             health_error_code = NULL,
             health_error_message = NULL,
             verified_at = ?
         WHERE id = ?`,
        verifiedAt,
        input.id,
      );
      transaction.run(
        `UPDATE repositories
         SET verified_at = ?,
             health = 'error',
             health_error_code = ?,
             health_error_message = ?
         WHERE id = (
           SELECT repository_id
           FROM github_repositories
           WHERE connection_id = ? AND forge_repository_id = ?
         )`,
        verifiedAt,
        errorCode,
        errorMessage,
        input.id,
        input.error.repositoryId as number,
      );
      transaction.run(
        `UPDATE github_repositories
         SET verification_id = ?
         WHERE connection_id = ? AND forge_repository_id = ?`,
        verificationId,
        input.id,
        input.error.repositoryId as number,
      );
    }
    if (completedIds.size > 0) {
      transaction.run(
        `UPDATE repositories
         SET verified_at = ?,
             health = 'healthy',
             health_error_code = NULL,
             health_error_message = NULL
         WHERE id IN (
           SELECT repository_id
           FROM github_repositories
           WHERE connection_id = ?
             AND forge_repository_id IN (${[...completedIds]
               .map(() => "?")
               .join(", ")})
         )`,
        verifiedAt,
        input.id,
        ...completedIds,
      );
      transaction.run(
        `UPDATE github_repositories
         SET verification_id = ?
         WHERE connection_id = ?
           AND forge_repository_id IN (${[...completedIds]
             .map(() => "?")
             .join(", ")})`,
        verificationId,
        input.id,
        ...completedIds,
      );
    }
    const recoveredIds = input.error
      ? [...completedIds]
      : input.affectedRepositoryIds;
    if (recoveredIds.length > 0) {
      resumeGitHubDeliveries(transaction, input.id, verifiedAt, recoveredIds);
    }
    transaction.run(
      `INSERT INTO github_connection_verifications (
         id, connection_id, trigger, outcome, error_code, error_message,
         error_repository_id, api_profile, principal_id, principal_login,
         permissions, capabilities, affected_repository_ids,
         repository_checks, repositories, verified_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      verificationId,
      input.id,
      input.trigger,
      outcome,
      errorCode,
      errorMessage,
      errorRepositoryId,
      input.profile,
      input.principal?.id ?? null,
      input.principal?.login ?? null,
      input.permissions === null ? null : JSON.stringify(input.permissions),
      input.capabilities === null ? null : JSON.stringify(input.capabilities),
      JSON.stringify(input.affectedRepositoryIds),
      JSON.stringify(repositoryChecks),
      JSON.stringify(input.evidence),
      verifiedAt,
    );
  };
  if (!defer) {
    durableCore.transaction(commit);
  }
  return { commit, id: verificationId, verifiedAt };
}
import { resumeGitHubDeliveries } from "./github-delivery-recovery.ts";
