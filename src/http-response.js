import { randomUUID } from "node:crypto";

import { currentIoOperationSignal } from "./io-operation-context.js";

const BROWSER_STYLE = `<style>
  :root {
    color-scheme: light;
    --page: oklch(97.5% 0.01 250);
    --surface: oklch(99.5% 0.003 250);
    --surface-muted: oklch(98% 0.006 250);
    --line: oklch(88% 0.015 250);
    --text: oklch(25% 0.02 250);
    --muted: oklch(43% 0.03 250);
    --accent: oklch(48% 0.16 255);
    --accent-soft: oklch(93% 0.035 250);
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  html {
    max-width: 100%;
    overflow-wrap: anywhere;
    background: var(--page);
  }

  body {
    min-height: 100vh;
    max-width: 72rem;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    background: var(--surface);
    color: var(--text);
    font-family:
      ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
    font-size: 0.95rem;
    line-height: 1.5;
  }

  header {
    margin-block-end: 2rem;
  }

  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    padding: 0.35rem;
    border-block-end: 1px solid var(--line);
  }

  nav a {
    padding: 0.5rem 0.7rem;
    border-radius: 0.45rem;
    color: var(--muted);
    font-weight: 650;
    text-decoration: none;
  }

  nav a:hover,
  nav a[aria-current="page"] {
    background: var(--accent-soft);
    color: var(--accent);
  }

  main {
    display: grid;
    gap: 1.5rem;
  }

  h1 {
    margin: 0;
    font-size: clamp(1.9rem, 4vw, 2.5rem);
    line-height: 1.1;
    letter-spacing: -0.025em;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
    line-height: 1.2;
  }

  h3,
  h4 {
    line-height: 1.25;
  }

  p {
    margin: 0;
  }

  form {
    display: grid;
    grid-template-columns: max-content minmax(8rem, 1fr) max-content minmax(8rem, 1fr);
    align-items: center;
    gap: 0.7rem;
    max-width: 100%;
    padding: 1rem;
    border: 1px solid var(--line);
    border-radius: 0.65rem;
    background: var(--surface-muted);
  }

  form > button,
  form > output,
  form > ol,
  form > ul,
  form > p,
  form > fieldset {
    grid-column: 1 / -1;
    justify-self: start;
  }

  form > ol,
  form > ul {
    width: 100%;
  }

  form > input,
  form > select,
  form > textarea {
    width: 100%;
    min-width: 0;
  }

  #review-criteria,
  #review-version-criteria {
    display: grid;
    gap: 0.75rem;
  }

  #review-criteria li,
  #review-version-criteria li {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: center;
    gap: 0.7rem;
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    background: var(--surface);
  }

  #review-criteria li > button,
  #review-version-criteria li > button {
    grid-column: 2;
    justify-self: start;
  }

  #review-criteria textarea,
  #review-version-criteria textarea {
    width: 100%;
    min-width: 0;
    min-height: 5rem;
  }

  #evaluation-create-form {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: start;
  }

  #evaluation-create-form .evaluation-field {
    display: grid;
    gap: 0.35rem;
    min-width: 0;
  }

  #evaluation-create-form .evaluation-field select,
  #evaluation-create-form .evaluation-field input {
    width: 100%;
    min-width: 0;
  }

  #evaluation-create-form .evaluation-field input {
    margin-block-start: 0.15rem;
  }

  label {
    color: var(--muted);
    font-size: 0.875rem;
    font-weight: 650;
  }

  input,
  select,
  textarea,
  button {
    max-width: 100%;
    min-height: 2.35rem;
    border: 1px solid oklch(80% 0.02 250);
    border-radius: 0.4rem;
    padding: 0.5rem 0.65rem;
    color: inherit;
    font: inherit;
    background: oklch(100% 0 0);
  }

  button {
    border-color: var(--accent);
    background: var(--accent);
    color: oklch(99% 0.005 255);
    font-weight: 700;
    cursor: pointer;
  }

  button:hover {
    background: oklch(43% 0.16 255);
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  main > section {
    max-width: 100%;
    overflow-x: auto;
    padding: 1rem;
    border: 1px solid var(--line);
    border-radius: 0.65rem;
    background: var(--surface-muted);
  }

  ol,
  ul {
    margin: 0;
    padding-inline-start: 1.25rem;
  }

  dd {
    margin: 0;
  }

  table {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 0.65rem 0.75rem;
    border-block-end: 1px solid var(--line);
    text-align: start;
    vertical-align: top;
  }

  th {
    color: var(--muted);
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow-wrap: normal;
  }

  #system-facts h2 {
    margin-block-end: 0.75rem;
  }

  #system-facts .system-model-list {
    display: grid;
    gap: 0.25rem;
  }

  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.5rem 1rem;
  }

  dt {
    color: var(--muted);
    font-weight: 650;
  }

  details {
    padding: 1rem;
    border: 1px solid var(--line);
    border-radius: 0.65rem;
    background: var(--surface-muted);
  }

  summary {
    cursor: pointer;
    font-weight: 700;
  }

  @media (max-width: 40rem) {
    body {
      padding: 1.25rem 1rem 3rem;
    }

    dl {
      grid-template-columns: minmax(0, 1fr);
    }

    dd {
      margin-inline-start: 0;
    }

    table {
      width: 100%;
      min-width: 0;
    }

    form,
    #evaluation-create-form {
      grid-template-columns: minmax(0, 1fr);
    }

    form > label,
    form > input,
    form > select,
    form > textarea,
    form > button,
    form > output,
    form > ol,
    form > ul,
    form > p,
    form > fieldset {
      grid-column: 1;
      grid-row: auto;
    }

    #review-criteria li,
    #review-version-criteria li {
      grid-template-columns: minmax(0, 1fr);
    }

    #review-criteria li > *,
    #review-version-criteria li > * {
      grid-column: 1;
    }

    table,
    thead,
    tbody,
    tr,
    th,
    td {
      display: block;
    }

    thead {
      position: absolute;
      clip: rect(0 0 0 0);
    }

    tr {
      border-block-end: 1px solid var(--line);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      scroll-behavior: auto !important;
      transition: none !important;
      animation: none !important;
    }
  }
</style>`;

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
    `<!doctype html><html lang="en"><head>${BROWSER_STYLE}</head><body>${body}</body></html>`,
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
