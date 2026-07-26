export class DurableCoreError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "DurableCoreError";
    this.code = code;
  }
}

export function fail(code, message, cause) {
  throw new DurableCoreError(code, message, { cause });
}
