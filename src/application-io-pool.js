import { removeExpiredBrowserSessions } from "./browser-session.js";
import { createIoExecutionPool } from "./io-execution-pool.js";
import { isIoTerminationFailure } from "./io-operation-context.js";

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
      return ioPool.run("acquisition", async (signal) => {
        signal?.throwIfAborted();
        try {
          const changeset = await repositories.resolvePushedSelectors(
            repositoryId,
            request,
          );
          signal?.throwIfAborted();
          return changeset;
        } catch (error) {
          if (isIoTerminationFailure(error)) {
            throw error;
          }
          signal?.throwIfAborted();
          throw error;
        }
      });
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
          return ioPool.runImmediate("retention", (signal) => {
            signal?.throwIfAborted();
            const result = removeExpiredBrowserSessions(durableCore, { now });
            signal?.throwIfAborted();
            return result;
          });
        },
        reserveBytes,
      });
      return { ...storageReserve, ioPool };
    },
  };
}
