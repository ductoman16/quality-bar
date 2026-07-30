import { randomUUID } from "node:crypto";

import { currentIoOperationSignal } from "./io-operation-context.js";

/** @param {number} status */
function assertProductOutputAvailable(status) {
  if (status < 400) {
    currentIoOperationSignal()?.throwIfAborted();
  }
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 * @param {import("node:http").OutgoingHttpHeaders} [headers]
 */
export function writeJson(response, status, body, headers = {}) {
  assertProductOutputAvailable(status);
  response.writeHead(status, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {string} body
 */
export function writeHtml(response, body) {
  assertProductOutputAvailable(200);
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="en"><body>${body}</body></html>`);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {string} body
 */
export function writeJavascript(response, body) {
  assertProductOutputAvailable(200);
  response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
  response.end(body);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {import("node:http").OutgoingHttpHeaders} [headers]
 */
export function writeEmpty(response, headers = {}) {
  assertProductOutputAvailable(204);
  response.writeHead(204, headers);
  response.end();
}

/**
 * @param {string} code
 * @param {string} message
 * @param {Array<{ code: string, message: string, path: string }>} [fields]
 */
export function createErrorDocument(code, message, fields) {
  const error = /** @type {{
   *   code: string,
   *   fields?: Array<{ code: string, message: string, path: string }>,
   *   message: string,
   *   request_id: string
   * }} */ ({
    code,
    message,
    request_id: randomUUID(),
  });
  if (fields?.length) {
    error.fields = fields;
  }
  return { error };
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {import("node:http").OutgoingHttpHeaders} [headers]
 * @param {Array<{ code: string, message: string, path: string }>} [fields]
 */
export function writeError(response, status, code, message, headers, fields) {
  const document = createErrorDocument(code, message, fields);
  writeJson(response, status, document, headers);
}
