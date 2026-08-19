import { isMcpRecord } from "./mcp-message.js";

/** @param {string} code @param {string} message */
export function mcpError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * @param {unknown} value
 * @param {Set<string>} keys
 * @returns {value is Record<string, unknown>}
 */
export function isClosedMcpRecord(value, keys) {
  return isMcpRecord(value) && Object.keys(value).every((key) => keys.has(key));
}

/**
 * @param {unknown} params
 * @returns {params is {
 *   name: string,
 *   arguments?: Record<string, unknown>,
 *   _meta?: Record<string, unknown>
 * }}
 */
export function isToolCallParameters(params) {
  return (
    isClosedMcpRecord(params, new Set(["name", "arguments", "_meta"])) &&
    typeof params.name === "string" &&
    (!Object.hasOwn(params, "arguments") || isMcpRecord(params.arguments)) &&
    (!Object.hasOwn(params, "_meta") || isMcpRecord(params._meta))
  );
}

/**
 * @param {unknown} params
 * @returns {params is {uri: string, _meta?: Record<string, unknown>}}
 */
export function isResourceReadParameters(params) {
  return (
    isClosedMcpRecord(params, new Set(["uri", "_meta"])) &&
    typeof params.uri === "string" &&
    (!Object.hasOwn(params, "_meta") || isMcpRecord(params._meta))
  );
}
