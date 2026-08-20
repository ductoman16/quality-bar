import { isProductSurface } from "./http-request.js";
import { runIoOperation } from "./io-operation-context.js";

/** @param {AbortSignal} workerSignal */
export function createProductRequestRunner(workerSignal) {
  if (!(workerSignal instanceof AbortSignal)) {
    throw new TypeError("workerSignal must provide the shutdown boundary");
  }
  /**
   * @param {string} path
   * @param {() => unknown} operation
   */
  return function runProductRequest(path, operation) {
    return Promise.resolve(
      isProductSurface(path)
        ? runIoOperation(workerSignal, operation)
        : operation(),
    );
  };
}
