import { randomUUID } from "node:crypto";

import { currentIoOperationSignal } from "./io-operation-context.ts";

import { FONO_LCD_STYLE } from "./browser/style-tokens.ts";
import { DISPLAY_FONT_STYLE } from "./browser/display-font.ts";

const BROWSER_STYLE = DISPLAY_FONT_STYLE + FONO_LCD_STYLE;

function assertProductOutputAvailable() {
  currentIoOperationSignal()?.throwIfAborted();
}

function assertExactUnavailableOutput(
  status: number,
  code: string,
  message: string,
) {
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

function writeJsonDocument(
  response: import("fastify").FastifyReply,
  status: number,
  body: unknown,
  headers: import("node:http").OutgoingHttpHeaders,
) {
  response.code(status).headers(headers).type("application/json").send(body);
}

export function writeJson(
  response: import("fastify").FastifyReply,
  status: number,
  body: unknown,
  headers: import("node:http").OutgoingHttpHeaders = {},
) {
  assertProductOutputAvailable();
  writeJsonDocument(response, status, body, headers);
}

export function writeHtml(
  response: import("fastify").FastifyReply,
  body: string,
  theme?: "dark" | "light",
) {
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

export function writeHtmlDocument(
  response: import("fastify").FastifyReply,
  body: string,
) {
  assertProductOutputAvailable();
  response.type("text/html; charset=utf-8").send(body);
}

export function writeEmpty(
  response: import("fastify").FastifyReply,
  headers: import("node:http").OutgoingHttpHeaders = {},
) {
  assertProductOutputAvailable();
  response.code(204).headers(headers).send();
}

export function writeStatus(
  response: import("fastify").FastifyReply,
  status: number,
  headers: import("node:http").OutgoingHttpHeaders = {},
) {
  assertProductOutputAvailable();
  response.code(status).headers(headers).send();
}

export function createErrorDocument(
  code: string,
  message: string,
  fields?: Array<{ code: string; message: string; path: string }>,
  requestId?: string,
) {
  const error = {
    code,
    message,
    request_id: requestId ?? randomUUID(),
  } as {
    code: string;
    fields?: Array<{ code: string; message: string; path: string }>;
    message: string;
    request_id: string;
  };
  if (fields?.length) {
    error.fields = fields;
  }
  return { error };
}

export function writeError(
  response: import("fastify").FastifyReply,
  status: number,
  code: string,
  message: string,
  headers?: import("node:http").OutgoingHttpHeaders,
  fields?: Array<{ code: string; message: string; path: string }>,
) {
  assertExactUnavailableOutput(status, code, message);
  const document = createErrorDocument(
    code,
    message,
    fields,
    response.request?.id,
  );
  writeJsonDocument(response, status, document, headers ?? {});
}
