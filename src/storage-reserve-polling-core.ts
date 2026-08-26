export function hasStorageReservePollingDependencies(
  durableCore: { all: Function; transaction: Function },
  storageReserve: {
    assertPollingObservationAdvanceAvailable: () => unknown;
    preparePollingObservationAdvance: () => unknown;
  },
) {
  return (
    typeof durableCore?.all === "function" &&
    typeof durableCore.transaction === "function" &&
    typeof storageReserve?.assertPollingObservationAdvanceAvailable ===
      "function" &&
    typeof storageReserve.preparePollingObservationAdvance === "function"
  );
}

export function runStorageReserveTransaction(
  durableCore: { transaction: Function },
  storageReserve: {
    assertPollingObservationAdvanceAvailable: () => unknown;
    preparePollingObservationAdvance: () => unknown;
  },
  callback: (transaction: any) => unknown,
) {
  storageReserve.preparePollingObservationAdvance();
  return durableCore.transaction((transaction: any) => {
    storageReserve.assertPollingObservationAdvanceAvailable();
    return callback(transaction);
  });
}

export function createStorageReservePollingCore(
  durableCore: { all: Function; transaction: Function },
  storageReserve: {
    assertPollingObservationAdvanceAvailable: () => unknown;
    preparePollingObservationAdvance: () => unknown;
  },
) {
  return {
    all: (...arguments_: Array<unknown>) => durableCore.all(...arguments_),
    transaction(callback: (transaction: any) => unknown) {
      return runStorageReserveTransaction(
        durableCore,
        storageReserve,
        callback,
      );
    },
  };
}
