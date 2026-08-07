import { DurableCoreError } from "./durable-error.js";

const SELECT_CONCURRENCY =
  "SELECT maximum_running FROM codex_execution_settings WHERE singleton = 1";

/** @param {unknown} value */
function requireConcurrency(value) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 4
  ) {
    throw new DurableCoreError(
      "codex_execution_concurrency_invalid",
      "Codex execution concurrency must be an integer from 1 through 4",
    );
  }
  return /** @type {number} */ (value);
}

/** @param {{ get: (sql: string) => any }} reader */
export function readCodexExecutionConcurrency(reader) {
  const row = reader.get(SELECT_CONCURRENCY);
  if (!row) {
    throw new DurableCoreError(
      "codex_execution_concurrency_unavailable",
      "Codex execution concurrency is unavailable",
    );
  }
  return requireConcurrency(row.maximum_running);
}

/** @param {any} durableCore */
export function createCodexExecutionConcurrencyService(durableCore) {
  if (
    typeof durableCore?.get !== "function" ||
    typeof durableCore.transaction !== "function"
  ) {
    throw new TypeError("durable core is required for Codex concurrency");
  }
  return {
    read() {
      return readCodexExecutionConcurrency(durableCore);
    },
    /** @param {unknown} value */
    set(value) {
      const maximumRunning = requireConcurrency(value);
      return durableCore.transaction((/** @type {any} */ transaction) => {
        const updated = transaction.run(
          `UPDATE codex_execution_settings
           SET maximum_running = ?
           WHERE singleton = 1`,
          maximumRunning,
        );
        if (updated.changes !== 1) {
          throw new DurableCoreError(
            "codex_execution_concurrency_unavailable",
            "Codex execution concurrency is unavailable",
          );
        }
        return maximumRunning;
      });
    },
  };
}
