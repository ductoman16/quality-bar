import { isMcpRecord } from "./mcp-message.js";

/** @param {string} code @param {string} message */
function mcpError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * @param {unknown} value
 * @param {Set<string>} keys
 * @returns {value is Record<string, unknown>}
 */
function isClosedRecord(value, keys) {
  return isMcpRecord(value) && Object.keys(value).every((key) => keys.has(key));
}

/** @param {unknown} arguments_ */
export function listRepositoryArguments(arguments_) {
  if (
    !isClosedRecord(arguments_, new Set(["cursor", "limit", "remote_url"])) ||
    (Object.hasOwn(arguments_, "cursor") &&
      (typeof arguments_.cursor !== "string" ||
        arguments_.cursor.length === 0)) ||
    (Object.hasOwn(arguments_, "limit") &&
      (typeof arguments_.limit !== "number" ||
        !Number.isInteger(arguments_.limit))) ||
    (Object.hasOwn(arguments_, "remote_url") &&
      (typeof arguments_.remote_url !== "string" ||
        arguments_.remote_url.length === 0))
  ) {
    throw mcpError("request_malformed", "Request is malformed");
  }
  return {
    cursor:
      typeof arguments_.cursor === "string" ? arguments_.cursor : undefined,
    limit:
      typeof arguments_.limit === "number"
        ? String(arguments_.limit)
        : undefined,
    remoteUrl:
      typeof arguments_.remote_url === "string"
        ? arguments_.remote_url
        : undefined,
  };
}

/** @param {unknown} arguments_ */
export function guidanceArguments(arguments_) {
  if (
    !isClosedRecord(arguments_, new Set(["repository_id"])) ||
    Object.keys(arguments_).length !== 1 ||
    typeof arguments_.repository_id !== "string" ||
    arguments_.repository_id.length === 0
  ) {
    throw mcpError("request_malformed", "Request is malformed");
  }
  return { repositoryId: arguments_.repository_id };
}
