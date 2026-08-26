export class SqliteBackupError extends Error {
  name: "SqliteBackupError";
  code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SqliteBackupError";
    this.code = code;
  }
}

export function failBackup(
  code: string,
  message: string,
  cause?: unknown,
): never {
  throw new SqliteBackupError(code, message, { cause });
}

export function owningBackupError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
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
