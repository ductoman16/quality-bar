import { DurableCoreError } from "./durable-error.js";
import { isFatalSqliteWrite } from "./durable-integrity.js";

const AsyncFunction = async function () {}.constructor;

/**
 * @typedef {Record<string, import("node:sqlite").SQLInputValue>} SqlRow
 * @typedef {import("node:sqlite").SQLInputValue} SqlParameter
 */

/** @param {SqlRow | undefined} row */
function cloneRow(row) {
  return row ? { ...row } : undefined;
}

/**
 * @param {import("node:sqlite").DatabaseSync} database
 * @param {{ onStorageUnavailable?: (error: DurableCoreError) => void }} options
 */
export function createDurableAccess(database, { onStorageUnavailable } = {}) {
  /** @type {DurableCoreError | undefined} */
  let storageFailure;

  function assertAvailable() {
    if (storageFailure) {
      throw storageFailure;
    }
  }

  /**
   * @param {unknown} error
   * @returns {never}
   */
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

  /**
   * @template Result
   * @param {() => Result} operation
   * @param {boolean} [write]
   * @returns {Result}
   */
  function execute(operation, write = false) {
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

  /** @param {() => boolean} transactionActive */
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
      /**
       * @param {string} sql
       * @param {...SqlParameter} parameters
       */
      get(sql, ...parameters) {
        assertTransactionActive();
        return cloneRow(
          execute(() => database.prepare(sql).get(...parameters)),
        );
      },
      /**
       * @param {string} sql
       * @param {...SqlParameter} parameters
       */
      all(sql, ...parameters) {
        assertTransactionActive();
        return execute(() => database.prepare(sql).all(...parameters)).map(
          cloneRow,
        );
      },
      /**
       * @param {string} sql
       * @param {...SqlParameter} parameters
       */
      run(sql, ...parameters) {
        assertTransactionActive();
        return execute(() => database.prepare(sql).run(...parameters), true);
      },
    };
  }

  return {
    /**
     * @param {string} sql
     * @param {...SqlParameter} parameters
     */
    get(sql, ...parameters) {
      return cloneRow(execute(() => database.prepare(sql).get(...parameters)));
    },
    /**
     * @param {string} sql
     * @param {...SqlParameter} parameters
     */
    all(sql, ...parameters) {
      return execute(() => database.prepare(sql).all(...parameters)).map(
        cloneRow,
      );
    },
    /**
     * @param {string} sql
     * @param {...SqlParameter} parameters
     */
    run(sql, ...parameters) {
      return execute(() => database.prepare(sql).run(...parameters), true);
    },
    /**
     * @template Result
     * @param {(transaction: ReturnType<typeof transactionAccess>) => Result} callback
     * @returns {Result}
     */
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
        /** @type {Result} */
        let result;
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
    close() {
      database.close();
    },
  };
}
