import { DurableCoreError } from "../durable/durable-error.ts";

const SELECT_CONCURRENCY =
  "SELECT maximum_running FROM codex_execution_settings WHERE singleton = 1";

function requireConcurrency(value: unknown) {
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
  return value as number;
}

export function readCodexExecutionConcurrency(reader: {
  get: (sql: string) => any;
}) {
  const row = reader.get(SELECT_CONCURRENCY);
  if (!row) {
    throw new DurableCoreError(
      "codex_execution_concurrency_unavailable",
      "Codex execution concurrency is unavailable",
    );
  }
  return requireConcurrency(row.maximum_running);
}

export function createCodexExecutionConcurrencyService(durableCore: any) {
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
    set(value: unknown) {
      const maximumRunning = requireConcurrency(value);
      return durableCore.transaction((transaction: any) => {
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
