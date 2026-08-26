import { removeExpiredBrowserSessions } from "../browser-session.ts";
import { createIoExecutionPool } from "../io-execution-pool.ts";
import { throwIoTerminationFailure } from "../io-operation-context.ts";
import { CHECKOUTS_PATH } from "../installation-environment.ts";
import { cleanupOwnedTemporaryArtifacts } from "../owned-artifact-cleanup.ts";
import { cleanupEligibleRetentionData } from "../retention.ts";

export function createApplicationIoPool({
  cleanupOwnedArtifacts = cleanupOwnedTemporaryArtifacts,
  cleanupRetentionData = cleanupEligibleRetentionData,
  reportBackgroundFailure,
}: {
  cleanupOwnedArtifacts?: typeof cleanupOwnedTemporaryArtifacts;
  cleanupRetentionData?: typeof cleanupEligibleRetentionData;
  reportBackgroundFailure: (error: unknown) => unknown;
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
    acquireChangeset(repositories: any, repositoryId: string, request: any) {
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
    createStorageReserve(
      createStorageReserve: Function,
      readDurableCore: () => any,
      now: () => number,
      reserveBytes: number,
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
