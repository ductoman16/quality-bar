import { isProductSurface } from "./http-request.ts";
import { runIoOperation } from "./io-operation-context.ts";

export function createProductRequestRunner(workerSignal: AbortSignal) {
  if (!(workerSignal instanceof AbortSignal)) {
    throw new TypeError("workerSignal must provide the shutdown boundary");
  }
  return function runProductRequest(path: string, operation: () => unknown) {
    return Promise.resolve(
      isProductSurface(path)
        ? runIoOperation(workerSignal, operation)
        : operation(),
    );
  };
}
