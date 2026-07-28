/**
 * @param {{all: Function, transaction: Function}} durableCore
 * @param {{
 *   assertPollingObservationAdvanceAvailable: () => unknown,
 *   preparePollingObservationAdvance: () => unknown
 * }} storageReserve
 */
export function hasStorageReservePollingDependencies(
  durableCore,
  storageReserve,
) {
  return (
    typeof durableCore?.all === "function" &&
    typeof durableCore.transaction === "function" &&
    typeof storageReserve?.assertPollingObservationAdvanceAvailable ===
      "function" &&
    typeof storageReserve.preparePollingObservationAdvance === "function"
  );
}

/**
 * @param {{transaction: Function}} durableCore
 * @param {{
 *   assertPollingObservationAdvanceAvailable: () => unknown,
 *   preparePollingObservationAdvance: () => unknown
 * }} storageReserve
 * @param {(transaction: any) => unknown} callback
 */
export function runStorageReserveTransaction(
  durableCore,
  storageReserve,
  callback,
) {
  storageReserve.preparePollingObservationAdvance();
  return durableCore.transaction((/** @type {any} */ transaction) => {
    storageReserve.assertPollingObservationAdvanceAvailable();
    return callback(transaction);
  });
}

/**
 * @param {{all: Function, transaction: Function}} durableCore
 * @param {{
 *   assertPollingObservationAdvanceAvailable: () => unknown,
 *   preparePollingObservationAdvance: () => unknown
 * }} storageReserve
 */
export function createStorageReservePollingCore(durableCore, storageReserve) {
  return {
    /** @param {...unknown} arguments_ */
    all: (...arguments_) => durableCore.all(...arguments_),
    /** @param {(transaction: any) => unknown} callback */
    transaction(callback) {
      return runStorageReserveTransaction(
        durableCore,
        storageReserve,
        callback,
      );
    },
  };
}
