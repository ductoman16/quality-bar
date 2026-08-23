import { removeExpiredBrowserSessions } from "../browser-session.js";
import { createIoExecutionPool } from "../io-execution-pool.js";
import { throwIoTerminationFailure } from "../io-operation-context.js";
import { CHECKOUTS_PATH } from "../installation-environment.js";
import { cleanupOwnedTemporaryArtifacts } from "../owned-artifact-cleanup.js";
import { cleanupEligibleRetentionData } from "../retention.js";

/**
 * @param {{
 *   cleanupOwnedArtifacts?: typeof cleanupOwnedTemporaryArtifacts,
 *   cleanupRetentionData?: typeof cleanupEligibleRetentionData,
 *   reportBackgroundFailure: (error: unknown) => unknown
 * }} options
 */
export function createApplicationIoPool({
  cleanupOwnedArtifacts = cleanupOwnedTemporaryArtifacts,
  cleanupRetentionData = cleanupEligibleRetentionData,
  reportBackgroundFailure,
}) {
  if (
    typeof reportBackgroundFailure !== "function" ||
    typeof cleanupOwnedArtifacts !== "function" ||
    typeof cleanupRetentionData !== "function"
  ) {
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
          throwIoTerminationFailure(error);
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
      function cleanupEligibleData() {
        const durableCore = readDurableCore();
        if (!durableCore) {
          throw new TypeError("durable core is required for storage cleanup");
        }
        return ioPool.runImmediate("cleanup", (signal) => {
          signal?.throwIfAborted();
          const sessions = removeExpiredBrowserSessions(durableCore, { now });
          cleanupRetentionData({ durableCore, now });
          const artifacts = cleanupOwnedArtifacts({
            checkoutRoot: CHECKOUTS_PATH,
            durableCore,
          });
          signal?.throwIfAborted();
          return { artifacts, sessions };
        });
      }
      const storageReserve = createStorageReserve({
        cleanupEligibleData,
        now,
        reserveBytes,
      });
      return {
        ...storageReserve,
        cleanupEligibleData:
          storageReserve.cleanupEligibleData ?? cleanupEligibleData,
        ioPool,
      };
    },
  };
}
