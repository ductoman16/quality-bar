export const IO_EXECUTION_CONCURRENCY = 4;
export const IO_EXECUTION_QUEUE_CAPACITY = 16;
const IO_DUTIES = new Set([
  "polling",
  "acquisition",
  "delivery",
  "retention",
  "cleanup",
]);

export class IoExecutionPoolError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "IoExecutionPoolError";
    this.code = code;
  }
}

export function createIoExecutionPool() {
  let active = 0;
  let accepting = true;
  /** @type {{operation: () => unknown, reject: (reason?: unknown) => void, resolve: (value: unknown) => void}[]} */
  const waiting = [];
  /** @type {((value?: void) => void)[]} */
  const drainWaiters = [];

  function finishDrain() {
    if (active !== 0 || waiting.length !== 0) {
      return;
    }
    for (const resolve of drainWaiters.splice(0)) {
      resolve();
    }
  }

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
          finishDrain();
        });
    }
  }

  /** @param {unknown} duty @param {unknown} operation */
  function validate(duty, operation) {
    if (!IO_DUTIES.has(/** @type {string} */ (duty))) {
      throw new TypeError("I/O execution duty is invalid");
    }
    if (typeof operation !== "function") {
      throw new TypeError("I/O execution operation is invalid");
    }
    if (!accepting) {
      throw new IoExecutionPoolError(
        "io_execution_pool_closed",
        "I/O execution pool is closed",
      );
    }
  }

  return {
    /**
     * @param {"polling" | "acquisition" | "delivery" | "retention" | "cleanup"} duty
     * @param {() => unknown} operation
     */
    run(duty, operation) {
      validate(duty, operation);
      if (waiting.length >= IO_EXECUTION_QUEUE_CAPACITY) {
        throw new IoExecutionPoolError(
          "io_execution_capacity_unavailable",
          "I/O execution capacity is unavailable",
        );
      }
      const completion = new Promise((resolve, reject) => {
        waiting.push({ operation, reject, resolve });
      });
      drain();
      return completion;
    },
    /**
     * @param {"polling" | "acquisition" | "delivery" | "retention" | "cleanup"} duty
     * @param {() => unknown} operation
     */
    runImmediate(duty, operation) {
      validate(duty, operation);
      if (active >= IO_EXECUTION_CONCURRENCY || waiting.length > 0) {
        throw new IoExecutionPoolError(
          "io_execution_capacity_unavailable",
          "I/O execution capacity is unavailable",
        );
      }
      active += 1;
      try {
        const result = operation();
        if (
          result &&
          typeof (/** @type {any} */ (result).then) === "function"
        ) {
          throw new TypeError("Immediate I/O execution must be synchronous");
        }
        return result;
      } finally {
        active -= 1;
        drain();
        finishDrain();
      }
    },
    close() {
      accepting = false;
      if (active === 0 && waiting.length === 0) {
        return Promise.resolve();
      }
      return new Promise((resolve) => drainWaiters.push(resolve));
    },
  };
}

/**
 * @param {{run: (duty: any, operation: () => unknown) => Promise<any>}} ioPool
 * @param {"polling" | "acquisition" | "delivery" | "retention" | "cleanup"} duty
 * @param {() => unknown} operation
 */
export function createIoDutyScheduler(ioPool, duty, operation) {
  if (typeof ioPool?.run !== "function" || typeof operation !== "function") {
    throw new TypeError("I/O duty scheduler dependencies are invalid");
  }
  let generation = 0;
  /** @type {{completion: Promise<unknown>, generation: number} | null} */
  let scheduled = null;
  function schedule() {
    if (scheduled?.generation === generation) {
      return scheduled.completion;
    }
    const entry = {
      generation,
      completion: /** @type {Promise<unknown>} */ (Promise.resolve()),
    };
    scheduled = entry;
    try {
      entry.completion = ioPool
        .run(duty, () =>
          entry.generation === generation ? operation() : undefined,
        )
        .finally(() => {
          if (scheduled === entry) {
            scheduled = null;
          }
        });
    } catch (error) {
      scheduled = null;
      throw error;
    }
    return entry.completion;
  }
  schedule.cancel = () => {
    generation += 1;
    scheduled = null;
  };
  return schedule;
}
