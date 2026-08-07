import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname } from "node:path";

import {
  fileRecord,
  hasDurableJsonTransaction,
  readTransactionMarker,
  recoverDurableJson,
  removeRecordedFile,
  requireRecordedFile,
  TRANSACTION_VERSION,
  transactionPaths,
} from "./release-canary-durable-transaction.mjs";
import {
  captureParent,
  fsyncDirectory,
  identity,
  isMissingPath,
  matchesIdentity,
  matchesSnapshot,
  normalizeFailure,
  readBoundJson,
  requireParent,
  requirePathIdentity,
} from "./release-canary-file-io.mjs";

export {
  captureParent,
  fsyncDirectory,
  hasDurableJsonTransaction,
  identity,
  isMissingPath,
  matchesIdentity,
  matchesSnapshot,
  normalizeFailure,
  readBoundJson,
  recoverDurableJson,
  requireParent,
  requirePathIdentity,
};

const MAX_RELEASE_CANARY_MANIFEST_BYTES = 1024 * 1024;

/**
 * @param {string} path
 * @param {unknown} value
 * @param {{birthtimeMs: number, dev: number, ino: number} | null | undefined} [expected]
 * @param {{birthtimeMs: number, dev: number, ino: number}} [expectedParent]
 * @param {import("node:fs").Stats | null} [expectedSnapshot]
 */
export function writeDurableJson(
  path,
  value,
  expected = undefined,
  expectedParent = captureParent(path),
  expectedSnapshot = null,
) {
  requireParent(path, expectedParent);
  recoverDurableJson(path, expectedParent);
  const target = resolveTarget(path, expected, expectedSnapshot);
  const serialized = serialize(value);
  const temporaryPath = `${path}.temporary`;
  const { committedPath, previousPath, transactionPath } =
    transactionPaths(path);
  let descriptor;
  let temporaryStatus = /** @type {import("node:fs").Stats | null} */ (null);
  let transactionStarted = false;
  let recoveryStarted = false;
  let publishedNew = false;
  /** @type {Error | null} */
  let operationFailure = null;
  /** @type {Error[]} */
  const cleanupFailures = [];
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_WRONLY,
      0o600,
    );
    writeFileSync(descriptor, `${serialized}\n`);
    fsyncSync(descriptor);
    temporaryStatus = fstatSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    requireTarget(path, target, expectedParent);

    if (target.identity === null) {
      publishNew(path, temporaryPath, temporaryStatus, expectedParent, () => {
        publishedNew = true;
      });
      return identity(temporaryStatus);
    }

    const previousRecord = fileRecord(lstatSync(path));
    const temporaryRecord = fileRecord(temporaryStatus);
    writeDurableJson(
      transactionPath,
      {
        evidenceTransactionVersion: TRANSACTION_VERSION,
        previous: previousRecord,
        temporary: temporaryRecord,
        temporaryName: basename(temporaryPath),
      },
      null,
      expectedParent,
    );
    transactionStarted = true;
    linkSync(path, previousPath);
    requireRecordedFile(
      path,
      previousRecord,
      "release canary manifest changed during publication",
    );
    requireRecordedFile(
      previousPath,
      previousRecord,
      "release canary previous manifest changed during publication",
    );
    fsyncDirectory(dirname(path), expectedParent);
    unlinkSync(path);
    requirePathIdentity(path, null);
    fsyncDirectory(dirname(path), expectedParent);
    linkSync(temporaryPath, path);
    publishedNew = true;
    requireRecordedFile(
      path,
      temporaryRecord,
      "release canary manifest changed during publication",
    );
    fsyncDirectory(dirname(path), expectedParent);
    commitTransaction({
      committedPath,
      expectedParent,
      path,
      transactionPath,
    });
    recoveryStarted = true;
    recoverDurableJson(path, expectedParent);
    return identity(temporaryStatus);
  } catch (error) {
    operationFailure = normalizeFailure(
      error,
      "release canary evidence write failed",
    );
  }
  if (operationFailure && recoveryStarted) {
    retainManifestFence(operationFailure);
  }
  if (descriptor !== undefined) {
    try {
      closeSync(descriptor);
    } catch (error) {
      cleanupFailures.push(
        normalizeFailure(
          error,
          "release canary evidence descriptor cleanup failed",
        ),
      );
    }
  }
  recoverFailedWrite({
    cleanupFailures,
    expectedParent,
    operationFailure,
    path,
    publishedNew,
    recoveryStarted,
    temporaryPath,
    temporaryStatus,
    transactionStarted,
  });
  if (operationFailure && cleanupFailures.length > 0) {
    const aggregate = new AggregateError(
      [operationFailure, ...cleanupFailures],
      "release canary evidence write and cleanup failed",
    );
    retainManifestFence(aggregate);
    throw aggregate;
  }
  if (operationFailure) {
    throw operationFailure;
  }
  throw new AggregateError(
    cleanupFailures,
    "release canary evidence cleanup failed",
  );
}

/** @param {string} path @param {any} expected @param {import("node:fs").Stats | null} expectedSnapshot */
function resolveTarget(path, expected, expectedSnapshot) {
  if (expected !== undefined) {
    return { identity: expected, snapshot: expectedSnapshot };
  }
  try {
    const status = lstatSync(path);
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new TypeError("release canary manifest is not a regular file");
    }
    return { identity: identity(status), snapshot: status };
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error;
    }
    return { identity: null, snapshot: null };
  }
}

/** @param {unknown} value */
function serialize(value) {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new TypeError("release canary evidence is not JSON serializable");
  }
  if (Buffer.byteLength(serialized) + 1 > MAX_RELEASE_CANARY_MANIFEST_BYTES) {
    throw new TypeError("release canary manifest is too large");
  }
  return serialized;
}

/** @param {string} path @param {{identity: any, snapshot: import("node:fs").Stats | null}} target @param {any} expectedParent */
function requireTarget(path, target, expectedParent) {
  requireParent(path, expectedParent);
  requirePathIdentity(path, target.identity);
  if (
    target.snapshot !== null &&
    !matchesSnapshot(target.snapshot, lstatSync(path))
  ) {
    throw new TypeError("release canary manifest changed before publication");
  }
}

/** @param {string} path @param {string} temporaryPath @param {import("node:fs").Stats} temporaryStatus @param {any} expectedParent @param {() => void} onPublished */
function publishNew(
  path,
  temporaryPath,
  temporaryStatus,
  expectedParent,
  onPublished,
) {
  const record = fileRecord(temporaryStatus);
  linkSync(temporaryPath, path);
  onPublished();
  requireRecordedFile(
    path,
    record,
    "release canary manifest changed during publication",
  );
  fsyncDirectory(dirname(path), expectedParent);
  removeRecordedFile(
    temporaryPath,
    record,
    "release canary temporary evidence cleanup failed",
  );
  fsyncDirectory(dirname(path), expectedParent);
}

/** @param {{committedPath: string, expectedParent: any, path: string, transactionPath: string}} input */
function commitTransaction(input) {
  const transaction = readTransactionMarker(
    input.transactionPath,
    input.expectedParent,
    input.path,
  );
  if (transaction === null) {
    throw new TypeError("release canary durable transaction changed");
  }
  linkSync(input.transactionPath, input.committedPath);
  const committed = readTransactionMarker(
    input.committedPath,
    input.expectedParent,
    input.path,
  );
  if (
    committed === null ||
    !matchesIdentity(transaction.identity, committed.identity) ||
    JSON.stringify(transaction.value) !== JSON.stringify(committed.value)
  ) {
    throw new TypeError("release canary committed marker changed");
  }
  try {
    fsyncDirectory(dirname(input.path), input.expectedParent);
  } catch (error) {
    try {
      removeRecordedFile(
        input.committedPath,
        fileRecord(committed.snapshot),
        "release canary failed commit marker cleanup failed",
      );
      fsyncDirectory(dirname(input.path), input.expectedParent);
    } catch (cleanupError) {
      const aggregate = new AggregateError(
        [
          normalizeFailure(error, "release canary commit sync failed"),
          normalizeFailure(
            cleanupError,
            "release canary failed commit cleanup failed",
          ),
        ],
        "release canary commit sync and rollback failed",
      );
      retainManifestFence(aggregate);
      throw aggregate;
    }
    throw error;
  }
}

/** @param {any} input */
function recoverFailedWrite(input) {
  if (
    input.transactionStarted &&
    !input.recoveryStarted &&
    !requiresManifestFence(input.operationFailure)
  ) {
    try {
      recoverDurableJson(input.path, input.expectedParent);
    } catch (error) {
      input.cleanupFailures.push(
        normalizeFailure(error, "release canary transaction recovery failed"),
      );
    }
    return;
  }
  if (input.transactionStarted) {
    return;
  }
  if (input.temporaryStatus === null) {
    return;
  }
  try {
    const record = fileRecord(input.temporaryStatus);
    if (input.publishedNew) {
      removeRecordedFile(
        input.path,
        record,
        "release canary failed publication ownership changed",
      );
    }
    removeRecordedFile(
      input.temporaryPath,
      record,
      "release canary temporary evidence cleanup failed",
    );
    fsyncDirectory(dirname(input.path), input.expectedParent);
  } catch (error) {
    input.cleanupFailures.push(
      normalizeFailure(error, "release canary publication cleanup failed"),
    );
  }
}

/** @param {Error} error */
function retainManifestFence(error) {
  Object.defineProperty(error, "releaseCanaryManifestFenced", {
    configurable: true,
    enumerable: false,
    value: true,
  });
}

/** @param {unknown} error */
function requiresManifestFence(error) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "releaseCanaryManifestFenced" in error &&
    error.releaseCanaryManifestFenced === true,
  );
}
