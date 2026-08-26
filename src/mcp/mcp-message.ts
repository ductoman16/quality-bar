export class McpMessageError extends Error {
  name: "McpMessageError";
  protocolCode: -32700 | -32600;

  constructor(protocolCode: -32700 | -32600, message: string) {
    super(message);
    this.name = "McpMessageError";
    this.protocolCode = protocolCode;
  }
}

export function isMcpRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mcpRequestId(message: unknown) {
  if (!isMcpRecord(message) || !Object.hasOwn(message, "id")) {
    return null;
  }
  return typeof message.id === "string" || typeof message.id === "number"
    ? message.id
    : null;
}

export type InitializeRequest = {
  id: string | number;
  jsonrpc: "2.0";
  method: "initialize";
  params: {
    capabilities: Record<string, unknown>;
    clientInfo: Record<string, unknown>;
    protocolVersion: string;
  };
};

export function isInitializeRequest(
  message: unknown,
): message is InitializeRequest {
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

export function isMcpNotification(message: unknown) {
  return (
    isMcpRecord(message) &&
    message.jsonrpc === "2.0" &&
    typeof message.method === "string" &&
    !Object.hasOwn(message, "id") &&
    (!Object.hasOwn(message, "params") || isMcpRecord(message.params))
  );
}

export function isMcpOperationRequest(message: unknown): message is {
  id: string | number;
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
} {
  return (
    isMcpRecord(message) &&
    message.jsonrpc === "2.0" &&
    typeof message.method === "string" &&
    Object.hasOwn(message, "id") &&
    (typeof message.id === "string" || typeof message.id === "number") &&
    (!Object.hasOwn(message, "params") || isMcpRecord(message.params))
  );
}

export function hasEmptyMcpParameters(params: unknown) {
  return (
    params === undefined ||
    (isMcpRecord(params) && Object.keys(params).length === 0)
  );
}

export function acceptedMcpMediaTypes(accept: string) {
  return new Set(
    accept
      .split(",")
      .map((value) => value.split(";", 1)[0].trim())
      .filter(Boolean),
  );
}

export async function readMcpMessage(
  request: import("fastify").FastifyRequest,
) {
  if (request.headers["content-type"] !== "application/json") {
    throw new McpMessageError(-32600, "Invalid Request");
  }
  return request.body;
}
