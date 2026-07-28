import { statfsSync } from "node:fs";

import { CHECKOUTS_PATH, STATE_PATH } from "./installation-environment.js";
import { DEFAULT_FREE_SPACE_RESERVE_BYTES } from "./installation-configuration.js";

const ACTIONS = Object.freeze({
  codexStart: "codex_start",
  pollingObservationAdvancement: "polling_observation_advancement",
  workAdmission: "work_admission",
});

export class StorageReserveError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} details
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, details, options) {
    super(message, options);
    this.name = "StorageReserveError";
    this.code = code;
    Object.assign(this, details);
  }
}

/** @param {string} path */
function readFilesystem(path) {
  return statfsSync(path, { bigint: true });
}

/** @param {number | bigint} value @param {string} fact */
function nonnegativeInteger(value, fact) {
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

/**
 * @param {{
 *   checkoutsPath?: string,
 *   reserveBytes?: number,
 *   statePath?: string,
 *   statfs?: (path: string) => {bavail: number | bigint, bsize: number | bigint}
 * }} [options]
 */
export function createStorageReserveGate({
  checkoutsPath = CHECKOUTS_PATH,
  reserveBytes = DEFAULT_FREE_SPACE_RESERVE_BYTES,
  statePath = STATE_PATH,
  statfs = readFilesystem,
} = {}) {
  if (
    typeof statePath !== "string" ||
    statePath.length === 0 ||
    typeof checkoutsPath !== "string" ||
    checkoutsPath.length === 0 ||
    !Number.isSafeInteger(reserveBytes) ||
    reserveBytes <= 0 ||
    typeof statfs !== "function"
  ) {
    throw new TypeError("storage reserve dependencies are invalid");
  }

  const filesystems = Object.freeze([
    Object.freeze({ filesystem: "state", path: statePath }),
    Object.freeze({ filesystem: "checkouts", path: checkoutsPath }),
  ]);

  /** @param {string} action */
  function readFor(action) {
    const facts = filesystems.map(({ filesystem, path }) => {
      let measurement;
      try {
        measurement = statfs(path);
      } catch (cause) {
        throw new StorageReserveError(
          "storage_reserve_check_failed",
          `The ${filesystem} filesystem free-space reserve could not be measured`,
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
          `The ${filesystem} filesystem returned invalid free-space facts`,
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
    const exactFacts = {
      filesystems: facts,
      reserve_bytes: reserveBytes,
      status: facts.every(({ status }) => status === "available")
        ? "available"
        : "unavailable",
    };
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
      readFor(ACTIONS.pollingObservationAdvancement),
    assertWorkAdmissionAvailable: () => readFor(ACTIONS.workAdmission),
    readFacts() {
      try {
        return readFor("system_read");
      } catch (error) {
        if (
          error instanceof StorageReserveError &&
          error.code === "storage_reserve_unavailable"
        ) {
          return /** @type {any} */ (error).facts;
        }
        throw error;
      }
    },
  };
}
