import { isMcpRecord } from "./mcp-message.ts";

export function mcpError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

export function isClosedMcpRecord(
  value: unknown,
  keys: Set<string>,
): value is Record<string, unknown> {
  return isMcpRecord(value) && Object.keys(value).every((key) => keys.has(key));
}

export function isToolCallParameters(params: unknown): params is {
  name: string;
  arguments?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
} {
  return (
    isClosedMcpRecord(params, new Set(["name", "arguments", "_meta"])) &&
    typeof params.name === "string" &&
    (!Object.hasOwn(params, "arguments") || isMcpRecord(params.arguments)) &&
    (!Object.hasOwn(params, "_meta") || isMcpRecord(params._meta))
  );
}

export function isResourceReadParameters(
  params: unknown,
): params is { uri: string; _meta?: Record<string, unknown> } {
  return (
    isClosedMcpRecord(params, new Set(["uri", "_meta"])) &&
    typeof params.uri === "string" &&
    (!Object.hasOwn(params, "_meta") || isMcpRecord(params._meta))
  );
}
