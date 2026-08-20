export class McpMessageError extends Error {
  /** @param {-32700 | -32600} protocolCode @param {string} message */
  constructor(protocolCode, message) {
    super(message);
    this.name = "McpMessageError";
    this.protocolCode = protocolCode;
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isMcpRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} message */
export function mcpRequestId(message) {
  if (!isMcpRecord(message) || !Object.hasOwn(message, "id")) {
    return null;
  }
  return typeof message.id === "string" || typeof message.id === "number"
    ? message.id
    : null;
}

/**
 * @typedef {{
 *   id: string | number,
 *   jsonrpc: "2.0",
 *   method: "initialize",
 *   params: {
 *     capabilities: Record<string, unknown>,
 *     clientInfo: Record<string, unknown>,
 *     protocolVersion: string
 *   }
 * }} InitializeRequest
 */

/** @param {unknown} message @returns {message is InitializeRequest} */
export function isInitializeRequest(message) {
  if (
    !isMcpRecord(message) ||
    message.jsonrpc !== "2.0" ||
    message.method !== "initialize" ||
    !Object.hasOwn(message, "id") ||
    !isMcpRecord(message.params)
  ) {
    return false;
  }
  const { params } = message;
  return (
    Object.keys(params).every((key) =>
      ["capabilities", "clientInfo", "protocolVersion", "_meta"].includes(key),
    ) &&
    isMcpRecord(params.capabilities) &&
    isMcpRecord(params.clientInfo) &&
    typeof params.clientInfo.name === "string" &&
    params.clientInfo.name.length > 0 &&
    typeof params.clientInfo.version === "string" &&
    params.clientInfo.version.length > 0 &&
    typeof params.protocolVersion === "string"
  );
}

/** @param {unknown} message */
export function isMcpNotification(message) {
  return (
    isMcpRecord(message) &&
    message.jsonrpc === "2.0" &&
    typeof message.method === "string" &&
    !Object.hasOwn(message, "id") &&
    (!Object.hasOwn(message, "params") || isMcpRecord(message.params))
  );
}

/**
 * @param {unknown} message
 * @returns {message is {
 *   id: string | number,
 *   jsonrpc: "2.0",
 *   method: string,
 *   params?: Record<string, unknown>
 * }}
 */
export function isMcpOperationRequest(message) {
  return (
    isMcpRecord(message) &&
    message.jsonrpc === "2.0" &&
    typeof message.method === "string" &&
    Object.hasOwn(message, "id") &&
    (typeof message.id === "string" || typeof message.id === "number") &&
    (!Object.hasOwn(message, "params") || isMcpRecord(message.params))
  );
}

/** @param {unknown} params */
export function hasEmptyMcpParameters(params) {
  return (
    params === undefined ||
    (isMcpRecord(params) && Object.keys(params).length === 0)
  );
}

/** @param {string} accept */
export function acceptedMcpMediaTypes(accept) {
  return new Set(
    accept
      .split(",")
      .map((value) => value.split(";", 1)[0].trim())
      .filter(Boolean),
  );
}

/** @param {import("fastify").FastifyRequest} request */
export async function readMcpMessage(request) {
  if (request.headers["content-type"] !== "application/json") {
    throw new McpMessageError(-32600, "Invalid Request");
  }
  return request.body;
}
