import { requireCodedError } from "../coded-error.js";
import {
  createErrorDocument,
  writeJson,
  writeStatus,
} from "../http-response.js";

/** @param {import("fastify").FastifyReply} response @param {unknown} id @param {unknown} result */
export function writeResult(response, id, result) {
  writeJson(response, 200, { id, jsonrpc: "2.0", result });
}

/** @param {import("fastify").FastifyReply} response @param {unknown} id @param {number} code @param {string} message */
export function writeProtocolError(response, id, code, message) {
  writeJson(response, 200, {
    error: { code, message },
    id,
    jsonrpc: "2.0",
  });
}

/** @param {import("fastify").FastifyReply} response @param {unknown} id */
export function writeProtocolVersionError(response, id) {
  writeJson(response, 400, {
    error: { code: -32600, message: "Invalid Request" },
    id,
    jsonrpc: "2.0",
  });
}

/** @param {import("fastify").FastifyReply} response @param {unknown} id @param {number} code @param {string} message @param {unknown} data */
export function writeProtocolErrorWithData(response, id, code, message, data) {
  const error =
    /** @type {{code: number, data?: unknown, message: string}} */ ({
      code,
      message,
    });
  if (data !== undefined) {
    error.data = data;
  }
  writeJson(response, 200, { error, id, jsonrpc: "2.0" });
}

/** @param {import("fastify").FastifyReply} response */
export function writeAccepted(response) {
  writeStatus(response, 202);
}

/** @param {unknown} document @param {Array<Record<string, unknown>>} links */
export function toolSuccess(document, links) {
  return {
    content: [{ text: JSON.stringify(document), type: "text" }, ...links],
    isError: false,
    structuredContent: document,
  };
}

/** @param {unknown} error */
function errorDocument(error) {
  try {
    const failure = requireCodedError(error);
    return createErrorDocument(failure.code, failure.message);
  } catch {
    return createErrorDocument("internal_error", "Internal server error");
  }
}

/** @param {unknown} error */
export function resourceFailure(error) {
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

/** @param {unknown} error */
export function toolFailure(error) {
  const document = errorDocument(error);
  return {
    content: [{ text: JSON.stringify(document), type: "text" }],
    isError: true,
    structuredContent: document,
  };
}
