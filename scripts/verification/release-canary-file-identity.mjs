/** @param {import("node:fs").Stats} status */
export function identity(status) {
  return {
    birthtimeMs: status.birthtimeMs,
    dev: status.dev,
    ino: status.ino,
  };
}

/** @param {{birthtimeMs: number, dev: number, ino: number}} expected @param {import("node:fs").Stats} actual */
export function matchesStatsIdentity(expected, actual) {
  return (
    expected.birthtimeMs === actual.birthtimeMs &&
    expected.dev === actual.dev &&
    expected.ino === actual.ino
  );
}

/** @param {{birthtimeMs: number, dev: number, ino: number}} left @param {{birthtimeMs: number, dev: number, ino: number}} right */
export function matchesIdentity(left, right) {
  return (
    left.birthtimeMs === right.birthtimeMs &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

/** @param {import("node:fs").Stats} expected @param {import("node:fs").Stats} actual */
export function matchesSnapshot(expected, actual) {
  return (
    matchesStatsIdentity(identity(expected), actual) &&
    expected.ctimeMs === actual.ctimeMs &&
    expected.mtimeMs === actual.mtimeMs &&
    expected.size === actual.size
  );
}

/** A rename may legitimately update ctime while preserving file content. */
/** @param {import("node:fs").Stats} expected @param {import("node:fs").Stats} actual */
export function matchesRelocatedSnapshot(expected, actual) {
  return (
    matchesStatsIdentity(identity(expected), actual) &&
    expected.mtimeMs === actual.mtimeMs &&
    expected.size === actual.size &&
    expected.mode === actual.mode &&
    expected.uid === actual.uid &&
    expected.gid === actual.gid
  );
}
