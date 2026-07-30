export const IO_EXECUTION_CONCURRENCY = 4;
const IO_DUTIES = new Set([
  "polling",
  "acquisition",
  "delivery",
  "retention",
  "cleanup",
]);

export function createIoExecutionPool() {
  let active = 0;
  /** @type {{operation: () => unknown, reject: (reason?: unknown) => void, resolve: (value: unknown) => void}[]} */
  const waiting = [];

  function drain() {
    while (active < IO_EXECUTION_CONCURRENCY && waiting.length > 0) {
      const task = waiting.shift();
      if (!task) {
        throw new Error("I/O execution pool queue is invalid");
      }
      active += 1;
      Promise.resolve()
        .then(task.operation)
        .then(task.resolve, task.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  }

  return {
    /**
     * @param {"polling" | "acquisition" | "delivery" | "retention" | "cleanup"} duty
     * @param {() => unknown} operation
     */
    run(duty, operation) {
      if (!IO_DUTIES.has(duty)) {
        throw new TypeError("I/O execution duty is invalid");
      }
      if (typeof operation !== "function") {
        throw new TypeError("I/O execution operation is invalid");
      }
      const completion = new Promise((resolve, reject) => {
        waiting.push({ operation, reject, resolve });
      });
      drain();
      return completion;
    },
  };
}

export const SHARED_IO_EXECUTION_POOL = createIoExecutionPool();

/**
 * @param {"polling" | "acquisition" | "delivery" | "retention" | "cleanup"} duty
 * @param {() => unknown} operation
 */
export function scheduleIoDuty(duty, operation) {
  return () => void SHARED_IO_EXECUTION_POOL.run(duty, operation);
}
