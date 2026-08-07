export class SqliteBackupError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "SqliteBackupError";
    this.code = code;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {never}
 */
export function failBackup(code, message, cause) {
  throw new SqliteBackupError(code, message, { cause });
}

/**
 * @param {unknown} error
 * @param {string} fallbackCode
 * @param {string} fallbackMessage
 */
export function owningBackupError(error, fallbackCode, fallbackMessage) {
  if (error instanceof SqliteBackupError) {
    return error;
  }
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return new SqliteBackupError(error.code, error.message, { cause: error });
  }
  return new SqliteBackupError(fallbackCode, fallbackMessage, {
    cause: error,
  });
}
