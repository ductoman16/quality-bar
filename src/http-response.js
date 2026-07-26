import { randomUUID } from "node:crypto";

export function writeJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

export function writeHtml(response, body) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="en"><body>${body}</body></html>`);
}

export function writeJavascript(response, body) {
  response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
  response.end(body);
}

export function writeEmpty(response, headers = {}) {
  response.writeHead(204, headers);
  response.end();
}

export function writeError(response, status, code, message, headers, fields) {
  const error = {
    code,
    message,
    request_id: randomUUID(),
  };
  if (fields?.length) {
    error.fields = fields;
  }
  writeJson(response, status, { error }, headers);
}
