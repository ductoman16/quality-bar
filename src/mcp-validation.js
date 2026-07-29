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
