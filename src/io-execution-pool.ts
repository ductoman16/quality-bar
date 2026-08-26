import {
  runIoOperation,
  throwIoTerminationFailure,
} from "./io-operation-context.ts";

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
  name: "IoExecutionPoolError";
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "IoExecutionPoolError";
    this.code = code;
  }
}

export function createIoExecutionPool({
  reportBackgroundFailure,
}: { reportBackgroundFailure?: (error: unknown) => unknown } = {}) {
  let active = 0;
  let accepting = true;
  let cleanupOnly = false;
  const workers = new AbortController();
  const cleanupWorkers = new AbortController();
  const waiting: {
    duty: string;
    operation: (signal?: AbortSignal) => unknown;
    reject: (reason?: unknown) => void;
    resolve: (value: unknown) => void;
  }[] = [];
  const drainWaiters: ((value?: void) => void)[] = [];

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
      const signal =
        task.duty === "cleanup" ? cleanupWorkers.signal : workers.signal;
      active += 1;
      Promise.resolve()
        .then(() =>
          runIoOperation(signal, () => {
            signal.throwIfAborted();
            return task.operation(signal);
          }),
        )
        .then(
          (result) => {
            signal.throwIfAborted();
            return result;
          },
          (error) => {
            throwIoTerminationFailure(error);
            signal.throwIfAborted();
            throw error;
          },
        )
        .then(task.resolve, task.reject)
        .finally(() => {
          active -= 1;
          drain();
          finishDrain();
        });
    }
  }

  function validate(duty: unknown, operation: unknown) {
    if (!IO_DUTIES.has(duty as string)) {
      throw new TypeError("I/O execution duty is invalid");
    }
    if (typeof operation !== "function") {
      throw new TypeError("I/O execution operation is invalid");
    }
    if (!accepting && (!cleanupOnly || duty !== "cleanup")) {
      throw new IoExecutionPoolError(
        "io_execution_pool_closed",
        "I/O execution pool is closed",
      );
    }
  }

  return {
    run(
      duty: "polling" | "acquisition" | "delivery" | "retention" | "cleanup",
      operation: (signal?: AbortSignal) => unknown,
    ) {
      validate(duty, operation);
      if (waiting.length >= IO_EXECUTION_QUEUE_CAPACITY) {
        throw new IoExecutionPoolError(
          "io_execution_capacity_unavailable",
          "I/O execution capacity is unavailable",
        );
      }
      const completion = new Promise((resolve, reject) => {
        waiting.push({ duty, operation, reject, resolve });
      });
      drain();
      return completion;
    },
    runImmediate(
      duty: "polling" | "acquisition" | "delivery" | "retention" | "cleanup",
      operation: (signal?: AbortSignal) => unknown,
    ) {
      validate(duty, operation);
      if (duty !== "retention" && duty !== "cleanup") {
        throw new TypeError(
          "Immediate I/O execution is reserved for retention or cleanup",
        );
      }
      if (active >= IO_EXECUTION_CONCURRENCY) {
        throw new IoExecutionPoolError(
          "io_execution_capacity_unavailable",
          "I/O execution capacity is unavailable",
        );
      }
      active += 1;
      const signal =
        duty === "cleanup" ? cleanupWorkers.signal : workers.signal;
      try {
        const result = operation(signal);
        if (result && typeof (result as any).then === "function") {
          throw new TypeError("Immediate I/O execution must be synchronous");
        }
        return result;
      } finally {
        active -= 1;
        drain();
        finishDrain();
      }
    },
    runInBackground(operation: () => unknown) {
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
      cleanupOnly = false;
      if (active === 0 && waiting.length === 0) {
        return Promise.resolve();
      }
      return new Promise((resolve) => drainWaiters.push(resolve));
    },
    shutdown(reason: unknown) {
      accepting = false;
      cleanupOnly = false;
      workers.abort(reason);
      cleanupWorkers.abort(reason);
      for (const task of waiting.splice(0)) {
        task.reject(reason);
      }
      finishDrain();
    },
    drainCleanup(reason: unknown) {
      if (!accepting && !cleanupOnly) {
        return;
      }
      accepting = false;
      cleanupOnly = true;
      workers.abort(reason);
      const cleanup = waiting.filter((task) => task.duty === "cleanup");
      for (const task of waiting.splice(0)) {
        if (task.duty !== "cleanup") {
          task.reject(reason);
        }
      }
      waiting.push(...cleanup);
      drain();
      finishDrain();
    },
  };
}

export function createIoDutyScheduler(
  ioPool: {
    run: (
      duty: any,
      operation: (signal?: AbortSignal) => unknown,
    ) => Promise<any>;
    runInBackground?: (operation: () => unknown) => boolean;
  },
  duty: "polling" | "acquisition" | "delivery" | "retention" | "cleanup",
  operation: (signal?: AbortSignal) => unknown,
) {
  if (typeof ioPool?.run !== "function" || typeof operation !== "function") {
    throw new TypeError("I/O duty scheduler dependencies are invalid");
  }
  let generation = 0;
  let scheduled: { completion: Promise<unknown>; generation: number } | null =
    null;
  function schedule() {
    if (scheduled?.generation === generation) {
      return scheduled.completion;
    }
    const entry = {
      generation,
      completion: Promise.resolve() as Promise<unknown>,
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
