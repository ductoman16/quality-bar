import { runIoOperation } from "./io-operation-context.js";

export const IO_EXECUTION_CONCURRENCY = 4;
export const IO_EXECUTION_QUEUE_CAPACITY = 16;
const IO_EXECUTION_ORDINARY_CONCURRENCY = IO_EXECUTION_CONCURRENCY - 1;
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

/**
 * @param {{reportBackgroundFailure?: (error: unknown) => unknown}} [options]
 */
export function createIoExecutionPool({ reportBackgroundFailure } = {}) {
  let active = 0;
  let accepting = true;
  const workers = new AbortController();
  /** @type {{operation: (signal?: AbortSignal) => unknown, reject: (reason?: unknown) => void, resolve: (value: unknown) => void}[]} */
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
    while (active < IO_EXECUTION_ORDINARY_CONCURRENCY && waiting.length > 0) {
      const task = waiting.shift();
      if (!task) {
        throw new Error("I/O execution pool queue is invalid");
      }
      active += 1;
      Promise.resolve()
        .then(() =>
          runIoOperation(workers.signal, () => {
            workers.signal.throwIfAborted();
            return task.operation(workers.signal);
          }),
        )
        .then((result) => {
          workers.signal.throwIfAborted();
          return result;
        })
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
     * @param {(signal?: AbortSignal) => unknown} operation
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
     * @param {(signal?: AbortSignal) => unknown} operation
     */
    runImmediate(duty, operation) {
      validate(duty, operation);
      if (duty !== "retention") {
        throw new TypeError(
          "Immediate I/O execution is reserved for retention cleanup",
        );
      }
      if (active >= IO_EXECUTION_CONCURRENCY) {
        throw new IoExecutionPoolError(
          "io_execution_capacity_unavailable",
          "I/O execution capacity is unavailable",
        );
      }
      active += 1;
      try {
        const result = operation(workers.signal);
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
    /** @param {() => unknown} operation */
    runInBackground(operation) {
      if (
        typeof operation !== "function" ||
        typeof reportBackgroundFailure !== "function"
      ) {
        throw new TypeError(
          "I/O background execution dependencies are invalid",
        );
      }
      try {
        void Promise.resolve(operation()).catch(reportBackgroundFailure);
        return true;
      } catch (error) {
        reportBackgroundFailure(error);
        return false;
      }
    },
    close() {
      accepting = false;
      if (active === 0 && waiting.length === 0) {
        return Promise.resolve();
      }
      return new Promise((resolve) => drainWaiters.push(resolve));
    },
    /** @param {unknown} reason */
    shutdown(reason) {
      accepting = false;
      workers.abort(reason);
      for (const task of waiting.splice(0)) {
        task.reject(reason);
      }
      finishDrain();
    },
  };
}

/**
 * @param {{run: (duty: any, operation: (signal?: AbortSignal) => unknown) => Promise<any>, runInBackground?: (operation: () => unknown) => boolean}} ioPool
 * @param {"polling" | "acquisition" | "delivery" | "retention" | "cleanup"} duty
 * @param {(signal?: AbortSignal) => unknown} operation
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
        .run(duty, async (signal) => {
          if (entry.generation !== generation) {
            return;
          }
          signal?.throwIfAborted();
          const result = await operation(signal);
          signal?.throwIfAborted();
          return result;
        })
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
  schedule.background = () => {
    if (typeof ioPool.runInBackground !== "function") {
      throw new TypeError("I/O background execution is unavailable");
    }
    return ioPool.runInBackground(schedule);
  };
  return schedule;
}
