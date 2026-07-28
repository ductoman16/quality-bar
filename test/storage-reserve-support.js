import { createForgejoConnectionService as createForgejoService } from "../src/forgejo-connection.js";
import { createGitHubConnectionService as createGitHubService } from "../src/github-connection.js";
import { createGitHubPollingRunner as createGitHubRunner } from "../src/github-polling-runner.js";

const facts = {
  filesystems: [
    {
      available_bytes: 8 * 1024 ** 3,
      filesystem: "state",
      path: "/var/lib/quality-bar",
      status: "available",
    },
    {
      available_bytes: 7 * 1024 ** 3,
      filesystem: "checkouts",
      path: "/var/cache/quality-bar/checkouts",
      status: "available",
    },
  ],
  reserve_bytes: 5 * 1024 ** 3,
  status: "available",
};

export const availableStorageReserve =
  /** @type {ReturnType<typeof import("../src/storage-reserve.js").createStorageReserveGate>} */ (
    Object.freeze({
      assertCodexStartAvailable: () => facts,
      assertPollingObservationAdvanceAvailable: () => facts,
      assertWorkAdmissionAvailable: () => facts,
      readFacts: () => facts,
    })
  );

/**
 * @param {Parameters<typeof createForgejoService>[0]} durableCore
 * @param {Omit<Parameters<typeof createForgejoService>[1], "storageReserve">} options
 */
export function createAvailableForgejoConnectionService(durableCore, options) {
  return createForgejoService(durableCore, {
    ...options,
    storageReserve: availableStorageReserve,
  });
}

/**
 * @param {Parameters<typeof createGitHubService>[0]} durableCore
 * @param {Omit<Parameters<typeof createGitHubService>[1], "storageReserve">} options
 */
export function createAvailableGitHubConnectionService(durableCore, options) {
  return createGitHubService(durableCore, {
    ...options,
    storageReserve: availableStorageReserve,
  });
}

/**
 * @param {Parameters<typeof createGitHubRunner>[0]} durableCore
 * @param {Omit<Parameters<typeof createGitHubRunner>[1], "storageReserve">} options
 */
export function createAvailableGitHubPollingRunner(durableCore, options) {
  return createGitHubRunner(durableCore, {
    ...options,
    storageReserve: availableStorageReserve,
  });
}
