import { randomUUID } from "node:crypto";

import { currentIoOperationSignal } from "./io-operation-context.js";

import { FONO_LCD_STYLE } from "./browser/style-tokens.js";
import { DISPLAY_FONT_STYLE } from "./browser/display-font.js";

const BROWSER_STYLE = DISPLAY_FONT_STYLE + FONO_LCD_STYLE;

// Applies the persisted (or system) theme before first paint to avoid a flash,
// keeps the header toggle's icon in sync, and flips + persists the theme on
// click via delegation (the toggle button is parsed after this head script).
const THEME_SCRIPT =
  '<script>(function(){var K="qb-theme",r=document.documentElement;function ic(){var b=document.querySelector(".qb-theme-toggle");if(b)b.textContent=r.getAttribute("data-theme")==="dark"?"\\u263e":"\\u263c";}function ap(t){t==="dark"?r.setAttribute("data-theme","dark"):r.removeAttribute("data-theme");ic();}try{ap(localStorage.getItem(K)||(matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light"));}catch(e){}document.addEventListener("click",function(e){var t=e.target.closest&&e.target.closest(".qb-theme-toggle");if(t){var d=r.getAttribute("data-theme")==="dark"?"light":"dark";try{localStorage.setItem(K,d);}catch(e){}ap(d);}});document.addEventListener("DOMContentLoaded",ic);})();</script>';

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
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 * @param {import("node:http").OutgoingHttpHeaders} headers
 */
function writeJsonDocument(response, status, body, headers) {
  response.writeHead(status, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 * @param {import("node:http").OutgoingHttpHeaders} [headers]
 */
export function writeJson(response, status, body, headers = {}) {
  assertProductOutputAvailable();
  writeJsonDocument(response, status, body, headers);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {string} body
 */
export function writeHtml(response, body) {
  assertProductOutputAvailable();
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(
    `<!doctype html><html lang="en"><head>${BROWSER_STYLE}${THEME_SCRIPT}</head><body>${body}</body></html>`,
  );
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {string} body
 */
export function writeJavascript(response, body) {
  assertProductOutputAvailable();
  response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
  response.end(body);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {import("node:http").OutgoingHttpHeaders} [headers]
 */
export function writeEmpty(response, headers = {}) {
  assertProductOutputAvailable();
  response.writeHead(204, headers);
  response.end();
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {import("node:http").OutgoingHttpHeaders} [headers]
 */
export function writeStatus(response, status, headers = {}) {
  assertProductOutputAvailable();
  response.writeHead(status, headers);
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
  assertExactUnavailableOutput(status, code, message);
  const document = createErrorDocument(code, message, fields);
  writeJsonDocument(response, status, document, headers ?? {});
}
