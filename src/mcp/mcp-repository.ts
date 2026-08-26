import { isClosedMcpRecord, mcpError } from "./mcp-validation.ts";

export function listRepositoryArguments(arguments_: unknown) {
  if (
    !isClosedMcpRecord(
      arguments_,
      new Set(["cursor", "limit", "remote_url"]),
    ) ||
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

export function guidanceArguments(arguments_: unknown) {
  if (
    !isClosedMcpRecord(arguments_, new Set(["repository_id"])) ||
    Object.keys(arguments_).length !== 1 ||
    typeof arguments_.repository_id !== "string" ||
    arguments_.repository_id.length === 0
  ) {
    throw mcpError("request_malformed", "Request is malformed");
  }
  return { repositoryId: arguments_.repository_id };
}
