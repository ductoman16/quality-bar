import { fail, RepositoryError } from "./repository-validation.ts";

export type RepositoryEnablementCore = {
  transaction<Result>(
    callback: (transaction: {
      run(
        sql: string,
        ...parameters: import("node:sqlite").SQLInputValue[]
      ): import("node:sqlite").StatementResultingChanges;
    }) => Result,
  ): Result;
};

export function recordRepositoryVerificationFailure(
  durableCore: RepositoryEnablementCore,
  {
    code,
    commit,
    id,
    lifecycle,
    lifecycleRevision,
    message,
  }: {
    code: string;
    commit?: (transaction: any) => void;
    id: string;
    lifecycle: string;
    lifecycleRevision: number;
    message: string;
  },
) {
  durableCore.transaction((transaction) => {
    commit?.(transaction);
    const failed = transaction.run(
      `UPDATE repositories
       SET health = 'error',
           health_error_code = ?,
           health_error_message = ?
       WHERE id = ? AND lifecycle = ? AND lifecycle_revision = ?`,
      code,
      message,
      id,
      lifecycle,
      lifecycleRevision,
    );
    if (failed.changes !== 1) {
      fail(
        "repository_lifecycle_conflict",
        "Repository changed during verification",
      );
    }
  });
}

export function recordPreparedRepositoryVerificationFailure(
  durableCore: RepositoryEnablementCore,
  error: unknown,
  repository: { id: string; lifecycle: string; lifecycleRevision: number },
) {
  if (error instanceof RepositoryError) {
    const cause =
      error.cause && typeof error.cause === "object"
        ? (error.cause as { commit?: unknown })
        : null;
    recordRepositoryVerificationFailure(durableCore, {
      code: error.code,
      commit:
        typeof cause?.commit === "function"
          ? (cause.commit as (transaction: any) => void)
          : undefined,
      id: repository.id,
      lifecycle: repository.lifecycle,
      lifecycleRevision: repository.lifecycleRevision,
      message: error.message,
    });
  } else if (
    error instanceof Error &&
    "commit" in error &&
    typeof error.commit === "function"
  ) {
    durableCore.transaction(error.commit as (transaction: any) => void);
  }
}

export function commitRepositoryEnablement(
  durableCore: RepositoryEnablementCore,
  prepared: { commit?: (transaction: any) => void } | void,
  {
    id,
    lifecycle,
    lifecycleRevision,
    timestamp,
  }: {
    id: string;
    lifecycle: string;
    lifecycleRevision: number;
    timestamp: number;
  },
) {
  durableCore.transaction((transaction) => {
    prepared?.commit?.(transaction);
    const enabled = transaction.run(
      `UPDATE repositories
       SET lifecycle = 'enabled',
           lifecycle_revision = lifecycle_revision + 1,
           health = 'healthy',
           health_error_code = NULL,
           health_error_message = NULL,
           verified_at = ?
       WHERE id = ? AND lifecycle = ? AND lifecycle_revision = ?`,
      timestamp,
      id,
      lifecycle,
      lifecycleRevision,
    );
    if (enabled.changes !== 1) {
      fail(
        "repository_lifecycle_conflict",
        "Repository changed during verification",
      );
    }
  });
}
