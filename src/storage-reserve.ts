import { statfsSync } from "node:fs";

import { CHECKOUTS_PATH, STATE_PATH } from "./installation-environment.ts";
import { DEFAULT_FREE_SPACE_RESERVE_BYTES } from "./installation-configuration.ts";

const ACTIONS = Object.freeze({
  codexStart: "codex_start",
  pollingObservationAdvancement: "polling_observation_advancement",
  workAdmission: "work_admission",
});

export class StorageReserveError extends Error {
  name: "StorageReserveError";
  code: string;

  constructor(
    code: string,
    message: string,
    details: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StorageReserveError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function requireStorageReservePause(error: unknown) {
  if (
    error instanceof StorageReserveError &&
    error.code === "storage_reserve_unavailable"
  ) {
    return;
  }
  throw error;
}

function readFilesystem(path: string) {
  return statfsSync(path, { bigint: true });
}

function nonnegativeInteger(value: number | bigint, fact: string) {
  const normalized = typeof value === "bigint" ? value : BigInt(value);
  if (
    normalized < 0n ||
    normalized > BigInt(Number.MAX_SAFE_INTEGER) ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  ) {
    throw new TypeError(`storage reserve ${fact} is invalid`);
  }
  return normalized;
}

export function createStorageReserveGate({
  checkoutsPath = CHECKOUTS_PATH,
  cleanupEligibleData,
  now = () => Date.now(),
  reserveBytes = DEFAULT_FREE_SPACE_RESERVE_BYTES,
  statePath = STATE_PATH,
  statfs = readFilesystem,
}: {
  checkoutsPath?: string;
  cleanupEligibleData: () => unknown;
  now?: () => number;
  reserveBytes?: number;
  statePath?: string;
  statfs?: (path: string) => {
    bavail: number | bigint;
    bsize: number | bigint;
  };
}) {
  if (
    typeof statePath !== "string" ||
    statePath.length === 0 ||
    typeof checkoutsPath !== "string" ||
    checkoutsPath.length === 0 ||
    !Number.isSafeInteger(reserveBytes) ||
    reserveBytes <= 0 ||
    typeof cleanupEligibleData !== "function" ||
    typeof now !== "function" ||
    typeof statfs !== "function"
  ) {
    throw new TypeError("storage reserve dependencies are invalid");
  }

  const filesystems = Object.freeze([
    Object.freeze({ filesystem: "state", path: statePath }),
    Object.freeze({ filesystem: "checkouts", path: checkoutsPath }),
  ]);
  let cleanupFacts: {
    artifacts_removed: number | null;
    error: { code: string; detail: string } | null;
    last_run_at: string | null;
    sessions_removed: number | null;
    status: "available" | "not_run" | "running" | "unavailable";
  } = {
    artifacts_removed: null,
    error: null,
    last_run_at: null,
    sessions_removed: null,
    status: "not_run",
  };

  function cleanupError(error: unknown) {
    if (!(error instanceof Error)) {
      throw new TypeError("Storage cleanup failure is not an Error");
    }
    return {
      code:
        "code" in error && typeof error.code === "string"
          ? error.code
          : "cleanup_failed",
      detail: error.message,
    };
  }

  function recordCleanupSuccess(result: any) {
    const completedAt = now();
    if (!Number.isSafeInteger(completedAt) || completedAt < 0) {
      throw new TypeError("Storage cleanup time is invalid");
    }
    cleanupFacts = {
      artifacts_removed:
        Number.isSafeInteger(result?.artifacts?.removed) &&
        result.artifacts.removed >= 0
          ? result.artifacts.removed
          : null,
      error: null,
      last_run_at: new Date(completedAt).toISOString(),
      sessions_removed:
        Number.isSafeInteger(result?.sessions?.changes) &&
        result.sessions.changes >= 0
          ? result.sessions.changes
          : null,
      status: "available",
    };
  }

  function recordCleanupFailure(error: unknown) {
    const failedAt = now();
    if (!Number.isSafeInteger(failedAt) || failedAt < 0) {
      throw new TypeError("Storage cleanup time is invalid");
    }
    cleanupFacts = {
      artifacts_removed: null,
      error: cleanupError(error),
      last_run_at: new Date(failedAt).toISOString(),
      sessions_removed: null,
      status: "unavailable",
    };
  }

  function trackedCleanup() {
    const startedAt = now();
    if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
      throw new TypeError("Storage cleanup time is invalid");
    }
    cleanupFacts = {
      artifacts_removed: null,
      error: null,
      last_run_at: new Date(startedAt).toISOString(),
      sessions_removed: null,
      status: "running",
    };
    try {
      const result = cleanupEligibleData();
      const promiseResult = result as any;
      if (promiseResult && typeof promiseResult.then === "function") {
        void Promise.resolve(promiseResult).then(
          recordCleanupSuccess,
          recordCleanupFailure,
        );
      } else {
        recordCleanupSuccess(result);
      }
      return result;
    } catch (error) {
      recordCleanupFailure(error);
      throw error;
    }
  }

  function measure(action: string) {
    const facts = filesystems.map(({ filesystem, path }) => {
      let measurement;
      try {
        measurement = statfs(path);
      } catch (cause) {
        throw new StorageReserveError(
          "storage_reserve_check_failed",
          `The ${filesystem} filesystem free-space reserve at ${path} could not be measured`,
          { action, filesystem, path },
          { cause },
        );
      }
      let availableBytes;
      try {
        const blockSize = nonnegativeInteger(measurement?.bsize, "block size");
        const availableBlocks = nonnegativeInteger(
          measurement?.bavail,
          "available blocks",
        );
        const available = blockSize * availableBlocks;
        if (available > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new TypeError("storage reserve available bytes are invalid");
        }
        availableBytes = Number(available);
      } catch (cause) {
        throw new StorageReserveError(
          "storage_reserve_check_failed",
          `The ${filesystem} filesystem at ${path} returned invalid free-space facts`,
          { action, filesystem, path },
          { cause },
        );
      }
      return {
        available_bytes: availableBytes,
        filesystem,
        path,
        status: availableBytes >= reserveBytes ? "available" : "unavailable",
      };
    });
    return {
      filesystems: facts,
      reserve_bytes: reserveBytes,
      status: facts.every(({ status }) => status === "available")
        ? "available"
        : "unavailable",
    };
  }

  function readFor(action: string) {
    let exactFacts = measure(action);
    if (exactFacts.status === "unavailable") {
      trackedCleanup();
      exactFacts = measure(action);
    }
    if (exactFacts.status === "unavailable") {
      throw new StorageReserveError(
        "storage_reserve_unavailable",
        "A required runtime filesystem is below the free-space reserve",
        { action, facts: exactFacts },
      );
    }
    return exactFacts;
  }

  function measureAvailable(action: string) {
    const exactFacts = measure(action);
    if (exactFacts.status === "unavailable") {
      throw new StorageReserveError(
        "storage_reserve_unavailable",
        "A required runtime filesystem is below the free-space reserve",
        { action, facts: exactFacts },
      );
    }
    return exactFacts;
  }

  return {
    assertCodexStartAvailable: () => readFor(ACTIONS.codexStart),
    assertPollingObservationAdvanceAvailable: () =>
      measureAvailable(ACTIONS.pollingObservationAdvancement),
    preparePollingObservationAdvance: () =>
      readFor(ACTIONS.pollingObservationAdvancement),
    assertWorkAdmissionAvailable: () => readFor(ACTIONS.workAdmission),
    cleanupEligibleData: trackedCleanup,
    readCleanupFacts() {
      return { ...cleanupFacts };
    },
    readFacts() {
      try {
        return readFor("system_read");
      } catch (error) {
        if (
          error instanceof StorageReserveError &&
          error.code === "storage_reserve_unavailable"
        ) {
          return (error as any).facts;
        }
        throw error;
      }
    },
  };
}
