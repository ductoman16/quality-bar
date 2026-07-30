import { isProductSurface } from "./http-request.js";
import { runIoOperation } from "./io-operation-context.js";

/**
 * @param {unknown} value
 * @param {string} message
 * @returns {asserts value is (...arguments_: never[]) => unknown}
 */
export function requireRequestFunction(value, message) {
  if (typeof value !== "function") {
    throw new TypeError(message);
  }
}

/** @param {AbortSignal} workerSignal */
export function createProductRequestRunner(workerSignal) {
  if (!(workerSignal instanceof AbortSignal)) {
    throw new TypeError("workerSignal must provide the shutdown boundary");
  }
  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => unknown} operation
   */
  return function runProductRequest(request, response, operation) {
    const productRequest =
      typeof request.url === "string" &&
      isProductSurface(
        new URL(request.url, "http://quality-bar.internal").pathname,
      );
    return Promise.resolve(
      productRequest
        ? runIoOperation(workerSignal, () => operation(request, response))
        : operation(request, response),
    );
  };
}
