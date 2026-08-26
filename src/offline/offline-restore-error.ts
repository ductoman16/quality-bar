export class OfflineRestoreError extends Error {
  name: "OfflineRestoreError";
  code: string;
  retainedPath: any;
  targetCommitted: any;

  constructor(
    code: string,
    message: string,
    options?: ErrorOptions & {
      retainedPath?: string;
      targetCommitted?: boolean;
    },
  ) {
    super(message, options);
    this.name = "OfflineRestoreError";
    this.code = code;
    this.retainedPath = options?.retainedPath;
    this.targetCommitted = options?.targetCommitted ?? false;
  }
}

export function failRestore(
  code: string,
  message: string,
  cause?: unknown,
): never {
  throw new OfflineRestoreError(code, message, { cause });
}

export function failRetainedRestore(
  code: string,
  message: string,
  retainedPath: string,
  cause: unknown,
  targetCommitted: boolean = false,
): never {
  throw new OfflineRestoreError(code, message, {
    cause,
    retainedPath,
    targetCommitted,
  });
}

export function owningRestoreError(
  error: unknown,
  code: string,
  message: string,
) {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error;
  }
  return new OfflineRestoreError(code, message, { cause: error });
}
