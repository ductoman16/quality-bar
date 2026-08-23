export class OfflineRestoreError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions & {
   *   retainedPath?: string,
   *   targetCommitted?: boolean,
   * }} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "OfflineRestoreError";
    this.code = code;
    this.retainedPath = options?.retainedPath;
    this.targetCommitted = options?.targetCommitted ?? false;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {never}
 */
export function failRestore(code, message, cause) {
  throw new OfflineRestoreError(code, message, { cause });
}

/**
 * @param {string} code
 * @param {string} message
 * @param {string} retainedPath
 * @param {unknown} cause
 * @param {boolean} [targetCommitted]
 * @returns {never}
 */
export function failRetainedRestore(
  code,
  message,
  retainedPath,
  cause,
  targetCommitted = false,
) {
  throw new OfflineRestoreError(code, message, {
    cause,
    retainedPath,
    targetCommitted,
  });
}

/**
 * @param {unknown} error
 * @param {string} code
 * @param {string} message
 */
export function owningRestoreError(error, code, message) {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error;
  }
  return new OfflineRestoreError(code, message, { cause: error });
}
