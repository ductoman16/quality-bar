/**
 * @param {{all: Function, transaction: Function}} durableCore
 * @param {{assertPollingObservationAdvanceAvailable: () => unknown}} storageReserve
 */
export function createStorageReservePollingCore(durableCore, storageReserve) {
  return {
    /** @param {...unknown} arguments_ */
    all: (...arguments_) => durableCore.all(...arguments_),
    /** @param {(transaction: any) => unknown} callback */
    transaction(callback) {
      return durableCore.transaction((/** @type {any} */ transaction) => {
        storageReserve.assertPollingObservationAdvanceAvailable();
        return callback(transaction);
      });
    },
  };
}
