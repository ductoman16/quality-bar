import { randomUUID } from "node:crypto";

import { currentIoOperationSignal } from "./io-operation-context.js";

import { FONO_LCD_STYLE } from "./browser/style-tokens.js";
import { DISPLAY_FONT_STYLE } from "./browser/display-font.js";

const BROWSER_STYLE = DISPLAY_FONT_STYLE + FONO_LCD_STYLE;

function assertProductOutputAvailable() {
  currentIoOperationSignal()?.throwIfAborted();
}

/** @param {number} status @param {string} code @param {string} message */
function assertExactUnavailableOutput(status, code, message) {
  const signal = currentIoOperationSignal();
  if (!signal?.aborted) {
    return;
  }
  const failure = signal.reason;
  if (
    status !== 503 ||
    !(failure instanceof Error) ||
    !("code" in failure) ||
    failure.code !== code ||
    failure.message !== message
  ) {
    throw failure;
  }
}

/**
 * @param {import("fastify").FastifyReply} response
 * @param {number} status
 * @param {unknown} body
 * @param {import("node:http").OutgoingHttpHeaders} headers
 */
function writeJsonDocument(response, status, body, headers) {
  response.code(status).headers(headers).type("application/json").send(body);
}

/**
 * @param {import("fastify").FastifyReply} response
 * @param {number} status
 * @param {unknown} body
 * @param {import("node:http").OutgoingHttpHeaders} [headers]
 */
export function writeJson(response, status, body, headers = {}) {
  assertProductOutputAvailable();
  writeJsonDocument(response, status, body, headers);
}

/**
 * @param {import("fastify").FastifyReply} response
 * @param {string} body
 * @param {"dark" | "light"} [theme] Operator's explicit theme; absent lets the
 *   stylesheet follow the OS via prefers-color-scheme.
 */
export function writeHtml(response, body, theme) {
  assertProductOutputAvailable();
  // Emit fixed literals (never the raw cookie value) so the attribute is
  // provably free of reflected input.
  const themeAttribute =
    theme === "dark"
      ? ' data-theme="dark"'
      : theme === "light"
        ? ' data-theme="light"'
        : "";
  response
    .type("text/html; charset=utf-8")
    .send(
      `<!doctype html><html lang="en"${themeAttribute}><head>${BROWSER_STYLE}</head><body>${body}</body></html>`,
    );
}

/** @param {import("fastify").FastifyReply} response @param {string} body */
export function writeHtmlDocument(response, body) {
  assertProductOutputAvailable();
  response.type("text/html; charset=utf-8").send(body);
}

/**
 * @param {import("fastify").FastifyReply} response
 * @param {import("node:http").OutgoingHttpHeaders} [headers]
 */
export function writeEmpty(response, headers = {}) {
  assertProductOutputAvailable();
  response.code(204).headers(headers).send();
}

/**
 * @param {import("fastify").FastifyReply} response
 * @param {number} status
 * @param {import("node:http").OutgoingHttpHeaders} [headers]
 */
export function writeStatus(response, status, headers = {}) {
  assertProductOutputAvailable();
  response.code(status).headers(headers).send();
}

/**
 * @param {string} code
 * @param {string} message
 * @param {Array<{ code: string, message: string, path: string }>} [fields]
 * @param {string} [requestId]
 */
export function createErrorDocument(code, message, fields, requestId) {
  const error = /** @type {{
   *   code: string,
   *   fields?: Array<{ code: string, message: string, path: string }>,
   *   message: string,
   *   request_id: string
   * }} */ ({
    code,
    message,
    request_id: requestId ?? randomUUID(),
  });
  if (fields?.length) {
    error.fields = fields;
  }
  return { error };
}

/**
 * @param {import("fastify").FastifyReply} response
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {import("node:http").OutgoingHttpHeaders} [headers]
 * @param {Array<{ code: string, message: string, path: string }>} [fields]
 */
export function writeError(response, status, code, message, headers, fields) {
  assertExactUnavailableOutput(status, code, message);
  const document = createErrorDocument(
    code,
    message,
    fields,
    response.request?.id,
  );
  writeJsonDocument(response, status, document, headers ?? {});
}
