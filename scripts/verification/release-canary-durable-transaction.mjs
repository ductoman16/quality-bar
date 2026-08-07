import { linkSync, lstatSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { removeOwnedFile } from "../../src/review-run-submission-file-cleanup.js";
import {
  captureParent,
  fsyncDirectory,
  isMissingPath,
  matchesIdentity,
  readBoundJson,
} from "./release-canary-file-io.mjs";

export const TRANSACTION_VERSION = 1;
const FILE_KEYS = "birthtimeMs dev gid ino mode mtimeMs size uid".split(" ");
const TRANSACTION_KEYS =
  "evidenceTransactionVersion previous temporary temporaryName".split(" ");

/** @param {import("node:fs").Stats} status */
export function fileRecord(status) {
  return {
    birthtimeMs: status.birthtimeMs,
    dev: status.dev,
    gid: status.gid,
    ino: status.ino,
    mode: status.mode,
    mtimeMs: status.mtimeMs,
    size: status.size,
    uid: status.uid,
  };
}

/** @param {unknown} value */
function validFileRecord(value) {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  return (
    Object.keys(value).sort().join("\0") === [...FILE_KEYS].sort().join("\0") &&
    FILE_KEYS.every(
      (key) => key in value && Number.isFinite(/** @type {any} */ (value)[key]),
    )
  );
}

/** @param {ReturnType<typeof fileRecord>} expected @param {import("node:fs").Stats} actual */
function matchesFileRecord(expected, actual) {
  return (
    actual.isFile() &&
    !actual.isSymbolicLink() &&
    expected.birthtimeMs === actual.birthtimeMs &&
    expected.dev === actual.dev &&
    expected.gid === actual.gid &&
    expected.ino === actual.ino &&
    expected.mode === actual.mode &&
    expected.mtimeMs === actual.mtimeMs &&
    expected.size === actual.size &&
    expected.uid === actual.uid
  );
}

/** @param {string} path */
export function transactionPaths(path) {
  return {
    committedPath: `${path}.committed`,
    previousPath: `${path}.previous`,
    transactionPath: `${path}.transaction`,
  };
}

/** @param {string} path */
export function hasDurableJsonTransaction(path) {
  const { committedPath, transactionPath } = transactionPaths(path);
  return (
    optionalStatus(transactionPath) !== null ||
    optionalStatus(committedPath) !== null
  );
}

/** @param {unknown} value @param {string} path */
function validTransaction(value, path) {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  if (
    Object.keys(value).sort().join("\0") !==
    [...TRANSACTION_KEYS].sort().join("\0")
  ) {
    return false;
  }
  const record = /** @type {any} */ (value);
  return (
    record.evidenceTransactionVersion === TRANSACTION_VERSION &&
    validFileRecord(record.previous) &&
    validFileRecord(record.temporary) &&
    typeof record.temporaryName === "string" &&
    record.temporaryName === basename(record.temporaryName) &&
    record.temporaryName === `${basename(path)}.temporary`
  );
}

/** @param {string} path */
function optionalStatus(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isMissingPath(error)) {
      return null;
    }
    throw error;
  }
}

/** @param {string} path @param {ReturnType<typeof fileRecord>} record @param {string} message */
export function requireRecordedFile(path, record, message) {
  const status = lstatSync(path);
  if (!matchesFileRecord(record, status)) {
    throw new TypeError(message);
  }
  return status;
}

/** @param {string} path @param {ReturnType<typeof fileRecord>} record @param {string} message */
export function removeRecordedFile(path, record, message) {
  const status = optionalStatus(path);
  if (status === null) {
    removeOwnedFile(path, {
      birthtimeMs: record.birthtimeMs,
      dev: record.dev,
      gid: record.gid,
      ino: record.ino,
      mode: record.mode,
      uid: record.uid,
    });
    return;
  }
  if (!matchesFileRecord(record, status)) {
    throw new TypeError(message);
  }
  if (
    !removeOwnedFile(path, {
      birthtimeMs: record.birthtimeMs,
      dev: record.dev,
      gid: record.gid,
      ino: record.ino,
      mode: record.mode,
      uid: record.uid,
    })
  ) {
    throw new TypeError(message);
  }
}

/** @param {string} markerPath @param {{birthtimeMs: number, dev: number, ino: number}} parentIdentity @param {string} targetPath */
export function readTransactionMarker(markerPath, parentIdentity, targetPath) {
  let marker;
  try {
    marker = readBoundJson(markerPath, parentIdentity);
  } catch (error) {
    if (isMissingPath(error)) {
      return null;
    }
    throw error;
  }
  if (!validTransaction(marker.value, targetPath)) {
    throw new TypeError("release canary durable transaction is invalid");
  }
  return marker;
}

/** @param {string} path @param {ReturnType<typeof readBoundJson>} marker @param {string} message */
function removeMarker(path, marker, message) {
  removeRecordedFile(path, fileRecord(marker.snapshot), message);
}

/**
 * @param {string} path
 * @param {{birthtimeMs: number, dev: number, ino: number}} [expectedParent]
 */
export function recoverDurableJson(path, expectedParent = captureParent(path)) {
  const { committedPath, previousPath, transactionPath } =
    transactionPaths(path);
  const transaction = readTransactionMarker(
    transactionPath,
    expectedParent,
    path,
  );
  const committed = readTransactionMarker(committedPath, expectedParent, path);
  const pendingTransactionPath = `${transactionPath}.temporary`;
  const pendingTransaction = readTransactionMarker(
    pendingTransactionPath,
    expectedParent,
    path,
  );
  if (pendingTransaction !== null) {
    if (
      transaction !== null &&
      (!matchesIdentity(transaction.identity, pendingTransaction.identity) ||
        JSON.stringify(transaction.value) !==
          JSON.stringify(pendingTransaction.value))
    ) {
      throw new TypeError("release canary pending transaction changed");
    }
    if (transaction === null && committed === null) {
      rollbackPendingTransaction({
        expectedParent,
        path,
        pendingTransaction,
        pendingTransactionPath,
        previousPath,
      });
      return;
    }
    removeMarker(
      pendingTransactionPath,
      pendingTransaction,
      "release canary pending transaction cleanup failed",
    );
    fsyncDirectory(dirname(path), expectedParent);
  }
  if (transaction === null && committed === null) {
    if (optionalStatus(previousPath) !== null) {
      throw new TypeError("release canary durable transaction is incomplete");
    }
    return;
  }
  if (
    transaction !== null &&
    committed !== null &&
    (!matchesIdentity(transaction.identity, committed.identity) ||
      JSON.stringify(transaction.value) !== JSON.stringify(committed.value))
  ) {
    throw new TypeError("release canary durable transaction changed");
  }
  const marker = /** @type {NonNullable<typeof transaction>} */ (
    committed ?? transaction
  );
  const record =
    /** @type {{evidenceTransactionVersion: 1, previous: ReturnType<typeof fileRecord>, temporary: ReturnType<typeof fileRecord>, temporaryName: string}} */ (
      marker.value
    );
  const temporaryPath = join(dirname(path), record.temporaryName);
  const canonical = optionalStatus(path);

  if (committed !== null) {
    finalizeCommitted({
      canonical,
      committed,
      committedPath,
      expectedParent,
      path,
      previousPath,
      record,
      temporaryPath,
      transaction,
      transactionPath,
    });
    return;
  }
  rollbackInterrupted({
    canonical,
    expectedParent,
    path,
    previousPath,
    record,
    temporaryPath,
    transaction: /** @type {NonNullable<typeof transaction>} */ (transaction),
    transactionPath,
  });
}

/** @param {any} input */
function rollbackPendingTransaction(input) {
  const record = input.pendingTransaction.value;
  const temporaryPath = join(dirname(input.path), record.temporaryName);
  const canonical = optionalStatus(input.path);
  if (
    canonical === null ||
    !matchesFileRecord(record.previous, canonical) ||
    optionalStatus(input.previousPath) !== null
  ) {
    throw new TypeError("release canary pending transaction is incomplete");
  }
  requireRecordedFile(
    temporaryPath,
    record.temporary,
    "release canary pending temporary manifest changed",
  );
  removeRecordedFile(
    temporaryPath,
    record.temporary,
    "release canary pending temporary manifest cleanup failed",
  );
  removeMarker(
    input.pendingTransactionPath,
    input.pendingTransaction,
    "release canary pending transaction cleanup failed",
  );
  fsyncDirectory(dirname(input.path), input.expectedParent);
}

/** @param {any} input */
function finalizeCommitted(input) {
  if (
    input.canonical === null ||
    !matchesFileRecord(input.record.temporary, input.canonical)
  ) {
    throw new TypeError("release canary committed manifest identity changed");
  }
  if (
    input.transaction === null &&
    (optionalStatus(input.previousPath) !== null ||
      optionalStatus(input.temporaryPath) !== null)
  ) {
    throw new TypeError("release canary committed transaction is incomplete");
  }
  if (input.transaction !== null) {
    removeRecordedFile(
      input.previousPath,
      input.record.previous,
      "release canary previous manifest cleanup failed",
    );
    removeRecordedFile(
      input.temporaryPath,
      input.record.temporary,
      "release canary temporary manifest cleanup failed",
    );
    fsyncDirectory(dirname(input.path), input.expectedParent);
    requireSameMarker(
      input.committedPath,
      input.committed,
      input.expectedParent,
      input.path,
    );
    removeMarker(
      input.transactionPath,
      input.transaction,
      "release canary durable transaction cleanup failed",
    );
    fsyncDirectory(dirname(input.path), input.expectedParent);
  }
  const currentCommitted = readTransactionMarker(
    input.committedPath,
    input.expectedParent,
    input.path,
  );
  if (
    currentCommitted === null ||
    !matchesIdentity(input.committed.identity, currentCommitted.identity) ||
    JSON.stringify(input.committed.value) !==
      JSON.stringify(currentCommitted.value)
  ) {
    throw new TypeError("release canary committed marker changed");
  }
  removeMarker(
    input.committedPath,
    currentCommitted,
    "release canary committed marker cleanup failed",
  );
  fsyncDirectory(dirname(input.path), input.expectedParent);
}

/** @param {string} markerPath @param {ReturnType<typeof readBoundJson>} expected @param {any} parentIdentity @param {string} targetPath */
function requireSameMarker(markerPath, expected, parentIdentity, targetPath) {
  const current = readTransactionMarker(markerPath, parentIdentity, targetPath);
  if (
    current === null ||
    !matchesIdentity(expected.identity, current.identity) ||
    JSON.stringify(expected.value) !== JSON.stringify(current.value)
  ) {
    throw new TypeError("release canary committed marker changed");
  }
}

/** @param {any} input */
function rollbackInterrupted(input) {
  if (
    input.canonical !== null &&
    matchesFileRecord(input.record.temporary, input.canonical)
  ) {
    removeRecordedFile(
      input.path,
      input.record.temporary,
      "release canary interrupted manifest rollback failed",
    );
    fsyncDirectory(dirname(input.path), input.expectedParent);
  } else if (
    input.canonical !== null &&
    !matchesFileRecord(input.record.previous, input.canonical)
  ) {
    throw new TypeError("release canary interrupted manifest identity changed");
  }
  if (optionalStatus(input.path) === null) {
    requireRecordedFile(
      input.previousPath,
      input.record.previous,
      "release canary previous manifest identity changed",
    );
    linkSync(input.previousPath, input.path);
    requireRecordedFile(
      input.path,
      input.record.previous,
      "release canary restored manifest identity changed",
    );
    fsyncDirectory(dirname(input.path), input.expectedParent);
  }
  removeRecordedFile(
    input.temporaryPath,
    input.record.temporary,
    "release canary temporary manifest cleanup failed",
  );
  removeRecordedFile(
    input.previousPath,
    input.record.previous,
    "release canary previous manifest cleanup failed",
  );
  fsyncDirectory(dirname(input.path), input.expectedParent);
  const currentTransaction = readTransactionMarker(
    input.transactionPath,
    input.expectedParent,
    input.path,
  );
  if (
    currentTransaction === null ||
    !matchesIdentity(input.transaction.identity, currentTransaction.identity) ||
    JSON.stringify(input.transaction.value) !==
      JSON.stringify(currentTransaction.value)
  ) {
    throw new TypeError("release canary durable transaction changed");
  }
  removeMarker(
    input.transactionPath,
    currentTransaction,
    "release canary durable transaction cleanup failed",
  );
  fsyncDirectory(dirname(input.path), input.expectedParent);
}
