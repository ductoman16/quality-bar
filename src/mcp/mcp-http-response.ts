import { requireCodedError } from "../coded-error.ts";
import {
  createErrorDocument,
  writeJson,
  writeStatus,
} from "../http-response.ts";

export function writeResult(
  response: import("fastify").FastifyReply,
  id: unknown,
  result: unknown,
) {
  writeJson(response, 200, { id, jsonrpc: "2.0", result });
}

export function writeProtocolError(
  response: import("fastify").FastifyReply,
  id: unknown,
  code: number,
  message: string,
) {
  writeJson(response, 200, {
    error: { code, message },
    id,
    jsonrpc: "2.0",
  });
}

export function writeProtocolVersionError(
  response: import("fastify").FastifyReply,
  id: unknown,
) {
  writeJson(response, 400, {
    error: { code: -32600, message: "Invalid Request" },
    id,
    jsonrpc: "2.0",
  });
}

export function writeProtocolErrorWithData(
  response: import("fastify").FastifyReply,
  id: unknown,
  code: number,
  message: string,
  data: unknown,
) {
  const error = {
    code,
    message,
  } as { code: number; data?: unknown; message: string };
  if (data !== undefined) {
    error.data = data;
  }
  writeJson(response, 200, { error, id, jsonrpc: "2.0" });
}

export function writeAccepted(response: import("fastify").FastifyReply) {
  writeStatus(response, 202);
}

export function toolSuccess(
  document: unknown,
  links: Array<Record<string, unknown>>,
) {
  return {
    content: [{ text: JSON.stringify(document), type: "text" }, ...links],
    isError: false,
    structuredContent: document,
  };
}

function errorDocument(error: unknown) {
  try {
    const failure = requireCodedError(error);
    return createErrorDocument(failure.code, failure.message);
  } catch {
    return createErrorDocument("internal_error", "Internal server error");
  }
}

export function resourceFailure(error: unknown) {
  try {
    const failure = requireCodedError(error);
    return {
      document: createErrorDocument(failure.code, failure.message),
      protocolCode: /_not_found$/.test(failure.code) ? -32002 : -32000,
    };
  } catch {
    return {
      document: createErrorDocument("internal_error", "Internal server error"),
      protocolCode: -32603,
    };
  }
}

export function toolFailure(error: unknown) {
  const document = errorDocument(error);
  return {
    content: [{ text: JSON.stringify(document), type: "text" }],
    isError: true,
    structuredContent: document,
  };
}
