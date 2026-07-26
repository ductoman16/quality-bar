import { DurableCoreError } from "./durable-error.js";
import { isFatalSqliteWrite } from "./durable-integrity.js";

const AsyncFunction = async function () {}.constructor;

function cloneRow(row) {
  return row ? { ...row } : undefined;
}

export function createDurableAccess(database, { onStorageUnavailable } = {}) {
  let storageFailure;

  function assertAvailable() {
    if (storageFailure) {
      throw storageFailure;
    }
  }

  function enterStorageUnavailable(error) {
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

  function execute(method, sql, parameters) {
    assertAvailable();
    try {
      return database.prepare(sql)[method](...parameters);
    } catch (error) {
      if (method === "run" && isFatalSqliteWrite(error)) {
        return enterStorageUnavailable(error);
      }
      throw error;
    }
  }

  function transactionAccess(transactionActive) {
    function assertTransactionActive() {
      if (!transactionActive()) {
        throw new DurableCoreError(
          "transaction_closed",
          "SQLite transaction is no longer active",
        );
      }
    }
    return {
      get(sql, ...parameters) {
        assertTransactionActive();
        return cloneRow(execute("get", sql, parameters));
      },
      all(sql, ...parameters) {
        assertTransactionActive();
        return execute("all", sql, parameters).map(cloneRow);
      },
      run(sql, ...parameters) {
        assertTransactionActive();
        return execute("run", sql, parameters);
      },
    };
  }

  return {
    get(sql, ...parameters) {
      return cloneRow(execute("get", sql, parameters));
    },
    all(sql, ...parameters) {
      return execute("all", sql, parameters).map(cloneRow);
    },
    run(sql, ...parameters) {
      return execute("run", sql, parameters);
    },
    transaction(callback) {
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
        let result;
        try {
          result = callback(transactionAccess(() => transactionActive));
        } finally {
          transactionActive = false;
        }
        if (typeof result?.then === "function") {
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
            error?.code === "storage_unavailable"
              ? (error.cause ?? error)
              : error;
          const combinedError = new AggregateError(
            [originalFailure, rollbackError],
            "SQLite transaction and rollback both failed",
          );
          if (
            error?.code === "storage_unavailable" ||
            isFatalSqliteWrite(error) ||
            isFatalSqliteWrite(rollbackError)
          ) {
            return enterStorageUnavailable(combinedError);
          }
          throw combinedError;
        }
        if (
          error?.code === "storage_unavailable" ||
          isFatalSqliteWrite(error)
        ) {
          return enterStorageUnavailable(error);
        }
        throw error;
      }
    },
    close() {
      database.close();
    },
  };
}
