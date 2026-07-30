import { removeExpiredBrowserSessions } from "./browser-session.js";
import { createIoExecutionPool } from "./io-execution-pool.js";

/** @param {{reportBackgroundFailure: (error: unknown) => unknown}} options */
export function createApplicationIoPool({ reportBackgroundFailure }) {
  if (typeof reportBackgroundFailure !== "function") {
    throw new TypeError("Application I/O failure reporter is required");
  }
  const ioPool = createIoExecutionPool({ reportBackgroundFailure });
  return {
    ...ioPool,
    /** @param {any} repositories @param {string} repositoryId @param {any} request */
    acquireChangeset(repositories, repositoryId, request) {
      if (typeof repositories?.resolvePushedSelectors !== "function") {
        throw new TypeError("Repository service is unavailable");
      }
      return ioPool.run("acquisition", () =>
        repositories.resolvePushedSelectors(repositoryId, request),
      );
    },
    /** @param {Function} createStorageReserve @param {() => any} readDurableCore @param {() => number} now @param {number} reserveBytes */
    createStorageReserve(
      createStorageReserve,
      readDurableCore,
      now,
      reserveBytes,
    ) {
      const storageReserve = createStorageReserve({
        cleanupEligibleData() {
          const durableCore = readDurableCore();
          if (!durableCore) {
            throw new TypeError("durable core is required for storage cleanup");
          }
          return ioPool.runImmediate("retention", () =>
            removeExpiredBrowserSessions(durableCore, { now }),
          );
        },
        reserveBytes,
      });
      return { ...storageReserve, ioPool };
    },
  };
}
