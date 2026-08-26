export class DurableCoreError extends Error {
  name: "DurableCoreError";
  code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DurableCoreError";
    this.code = code;
  }
}

export function fail(code: string, message: string, cause?: unknown): never {
  throw new DurableCoreError(code, message, { cause });
}
