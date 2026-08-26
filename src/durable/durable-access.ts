import { DurableCoreError } from "./durable-error.ts";
import { isFatalSqliteWrite } from "./durable-integrity.ts";

const AsyncFunction = async function () {}.constructor;

export type SqlRow = Record<string, import("node:sqlite").SQLInputValue>;
export type SqlParameter = import("node:sqlite").SQLInputValue;

function cloneRow(row: SqlRow | undefined) {
  return row ? { ...row } : undefined;
}

export function createDurableAccess(
  database: import("node:sqlite").DatabaseSync,
  {
    onStorageUnavailable,
    retentionCleanupState,
  }: {
    onStorageUnavailable?: (error: DurableCoreError) => void;
    retentionCleanupState?: { active: boolean };
  } = {},
) {
  let storageFailure: DurableCoreError | undefined;

  function assertAvailable() {
    if (storageFailure) {
      throw storageFailure;
    }
  }

  function enterStorageUnavailable(error: unknown): never {
    if (!storageFailure) {
      storageFailure = new DurableCoreError(
        "storage_unavailable",
        "SQLite durable write failed",
        { cause: error },
      );
      onStorageUnavailable?.(storageFailure);
    } else if (error instanceof AggregateError) {
      storageFailure.cause = error;
    }
    throw storageFailure;
  }

  function execute<Result>(
    operation: () => Result,
    write: boolean = false,
  ): Result {
    assertAvailable();
    try {
      return operation();
    } catch (error) {
      if (write && isFatalSqliteWrite(error)) {
        return enterStorageUnavailable(error);
      }
      throw error;
    }
  }

  function transactionAccess(transactionActive: () => boolean) {
    function assertTransactionActive() {
      if (!transactionActive()) {
        throw new DurableCoreError(
          "transaction_closed",
          "SQLite transaction is no longer active",
        );
      }
    }
    return {
      get(sql: string, ...parameters: Array<SqlParameter>) {
        assertTransactionActive();
        return cloneRow(
          execute(() => database.prepare(sql).get(...parameters)),
        );
      },
      all(sql: string, ...parameters: Array<SqlParameter>) {
        assertTransactionActive();
        return execute(() => database.prepare(sql).all(...parameters)).map(
          cloneRow,
        );
      },
      run(sql: string, ...parameters: Array<SqlParameter>) {
        assertTransactionActive();
        return execute(() => database.prepare(sql).run(...parameters), true);
      },
    };
  }

  return {
    get(sql: string, ...parameters: Array<SqlParameter>) {
      return cloneRow(execute(() => database.prepare(sql).get(...parameters)));
    },
    all(sql: string, ...parameters: Array<SqlParameter>) {
      return execute(() => database.prepare(sql).all(...parameters)).map(
        cloneRow,
      );
    },
    run(sql: string, ...parameters: Array<SqlParameter>) {
      return execute(() => database.prepare(sql).run(...parameters), true);
    },
    transaction<Result>(
      callback: (transaction: ReturnType<typeof transactionAccess>) => Result,
    ): Result {
      assertAvailable();
      if (callback instanceof AsyncFunction) {
        throw new DurableCoreError(
          "asynchronous_transaction_unsupported",
          "SQLite transaction callback must be synchronous",
        );
      }
      let transactionStarted = false;
      let transactionActive = false;
      try {
        database.exec("BEGIN IMMEDIATE");
        transactionStarted = true;
        transactionActive = true;
        let result: Result;
        try {
          result = callback(transactionAccess(() => transactionActive));
        } finally {
          transactionActive = false;
        }
        if (
          result !== null &&
          (typeof result === "object" || typeof result === "function") &&
          "then" in result &&
          typeof result.then === "function"
        ) {
          const asynchronousTransactionError = new DurableCoreError(
            "asynchronous_transaction_unsupported",
            "SQLite transaction callback must be synchronous",
          );
          Promise.resolve(result).catch((error) => {
            asynchronousTransactionError.cause = error;
          });
          throw asynchronousTransactionError;
        }
        database.exec("COMMIT");
        return result;
      } catch (error) {
        transactionActive = false;
        let rollbackError = null;
        if (transactionStarted) {
          try {
            database.exec("ROLLBACK");
          } catch (caughtRollbackError) {
            rollbackError = caughtRollbackError;
          }
        }
        if (rollbackError) {
          const originalFailure =
            error instanceof DurableCoreError &&
            error.code === "storage_unavailable"
              ? (error.cause ?? error)
              : error;
          const combinedError = new AggregateError(
            [originalFailure, rollbackError],
            "SQLite transaction and rollback both failed",
          );
          if (
            (error instanceof DurableCoreError &&
              error.code === "storage_unavailable") ||
            isFatalSqliteWrite(error) ||
            isFatalSqliteWrite(rollbackError)
          ) {
            return enterStorageUnavailable(combinedError);
          }
          throw combinedError;
        }
        if (
          (error instanceof DurableCoreError &&
            error.code === "storage_unavailable") ||
          isFatalSqliteWrite(error)
        ) {
          return enterStorageUnavailable(error);
        }
        throw error;
      }
    },
    retentionTransaction<Result>(
      callback: (transaction: ReturnType<typeof transactionAccess>) => Result,
    ): Result {
      if (!retentionCleanupState) {
        throw new DurableCoreError(
          "retention_transaction_unavailable",
          "SQLite retention transaction is unavailable",
        );
      }
      return this.transaction((transaction) => {
        retentionCleanupState.active = true;
        try {
          return callback(transaction);
        } finally {
          retentionCleanupState.active = false;
        }
      });
    },
    close() {
      database.close();
    },
  };
}
