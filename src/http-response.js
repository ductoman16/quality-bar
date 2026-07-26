import { randomUUID } from "node:crypto";

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 * @param {import("node:http").OutgoingHttpHeaders} [headers]
 */
export function writeJson(response, status, body, headers = {}) {
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
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="en"><body>${body}</body></html>`);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {string} body
 */
export function writeJavascript(response, body) {
  response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
  response.end(body);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {import("node:http").OutgoingHttpHeaders} [headers]
 */
export function writeEmpty(response, headers = {}) {
  response.writeHead(204, headers);
  response.end();
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
  writeJson(response, status, { error }, headers);
}
