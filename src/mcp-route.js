import { assertAllowedQueryParameters } from "./http-request.js";
import { requireCodedError } from "./coded-error.js";
import { createErrorDocument, writeError, writeJson } from "./http-response.js";
import {
  MCP_RESOURCE_TEMPLATES,
  MCP_PROTOCOL_VERSION,
  MCP_TOOLS,
  mcpInitializeResult,
} from "./mcp-contract.js";
import {
  acceptedMcpMediaTypes,
  hasEmptyMcpParameters,
  isInitializeRequest,
  isMcpNotification,
  isMcpOperationRequest,
  isMcpRecord,
  McpMessageError,
  mcpRequestId,
  readMcpMessage,
} from "./mcp-message.js";
import { createMcpOutcomeRecorder } from "./mcp-operation.js";

/**
 * @param {import("node:http").ServerResponse} response
 * @param {unknown} id
 * @param {unknown} result
 */
function writeResult(response, id, result) {
  writeJson(response, 200, { id, jsonrpc: "2.0", result });
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {unknown} id
 * @param {number} code
 * @param {string} message
 */
function writeProtocolError(response, id, code, message) {
  writeJson(response, 200, {
    error: { code, message },
    id,
    jsonrpc: "2.0",
  });
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {unknown} id
 */
function writeProtocolVersionError(response, id) {
  writeJson(response, 400, {
    error: { code: -32600, message: "Invalid Request" },
    id,
    jsonrpc: "2.0",
  });
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {unknown} id
 * @param {number} code
 * @param {string} message
 * @param {unknown} [data]
 */
function writeProtocolErrorWithData(response, id, code, message, data) {
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

/** @param {import("node:http").ServerResponse} response */
function writeAccepted(response) {
  response.writeHead(202);
  response.end();
}

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
function listRepositoryArguments(arguments_) {
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
function guidanceArguments(arguments_) {
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

/**
 * @param {unknown} params
 * @returns {params is {
 *   name: string,
 *   arguments?: Record<string, unknown>,
 *   _meta?: Record<string, unknown>
 * }}
 */
function isToolCallParameters(params) {
  return (
    isClosedRecord(params, new Set(["name", "arguments", "_meta"])) &&
    typeof params.name === "string" &&
    (!Object.hasOwn(params, "arguments") || isMcpRecord(params.arguments)) &&
    (!Object.hasOwn(params, "_meta") || isMcpRecord(params._meta))
  );
}

/**
 * @param {unknown} params
 * @returns {params is {uri: string, _meta?: Record<string, unknown>}}
 */
function isResourceReadParameters(params) {
  return (
    isClosedRecord(params, new Set(["uri", "_meta"])) &&
    typeof params.uri === "string" &&
    (!Object.hasOwn(params, "_meta") || isMcpRecord(params._meta))
  );
}

/** @param {{id: string}} repository */
function repositoryUri(repository) {
  return `quality-bar://v1/repositories/${encodeURIComponent(repository.id)}`;
}

/** @param {{id: string}} repository */
function repositoryLink(repository) {
  return {
    mimeType: "application/json",
    name: repository.id,
    type: "resource_link",
    uri: repositoryUri(repository),
  };
}

/**
 * @param {unknown} document
 * @param {Array<Record<string, unknown>>} links
 */
function toolSuccess(document, links) {
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
function toolFailure(error) {
  const document = errorDocument(error);
  return {
    content: [{ text: JSON.stringify(document), type: "text" }],
    isError: true,
    structuredContent: document,
  };
}

/** @param {string} uri */
function repositoryResourceMatch(uri) {
  const match = /^quality-bar:\/\/v1\/repositories\/([^/]+)(\/guidance)?$/.exec(
    uri,
  );
  if (!match) {
    return null;
  }
  try {
    return {
      guidance: match[2] !== undefined,
      repositoryId: decodeURIComponent(match[1]),
    };
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   browserOrigin: string,
 *   recordMcpOperation: (event: {
 *     durationMs: number,
 *     errorCode?: string,
 *     operation: string,
 *     outcome: "success" | "failure",
 *     requestId: string,
 *     resourceIds: string[]
 *   }) => void,
 *   repositories: Omit<ReturnType<typeof import("./repository.js").createRepositoryService>, "resolvePushedSelectors" | "resolvePullRequestChangeset">,
 *   repositoryGuidance: ReturnType<typeof import("./repository-guidance.js").createRepositoryGuidanceService>
 * }} dependencies
 */
export function createMcpRoute({
  browserOrigin,
  recordMcpOperation,
  repositories,
  repositoryGuidance,
}) {
  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {URL} requestUrl
   */
  return async function handleMcp(request, response, requestUrl) {
    if (requestUrl.pathname !== "/mcp/v1") {
      return false;
    }
    if (request.headers.origin && request.headers.origin !== browserOrigin) {
      writeError(response, 403, "origin_invalid", "Origin is invalid");
      return true;
    }
    if (!["POST"].includes(request.method ?? "")) {
      writeError(response, 405, "method_not_allowed", "Method is not allowed", {
        allow: "POST",
      });
      return true;
    }
    try {
      assertAllowedQueryParameters(requestUrl, new Set());
    } catch {
      writeProtocolError(response, null, -32600, "Invalid Request");
      return true;
    }
    const accept = request.headers.accept;
    const mediaTypes =
      typeof accept === "string" ? acceptedMcpMediaTypes(accept) : new Set();
    if (
      !mediaTypes.has("application/json") ||
      !mediaTypes.has("text/event-stream")
    ) {
      writeProtocolError(response, null, -32600, "Invalid Request");
      return true;
    }

    let message;
    try {
      message = await readMcpMessage(request);
    } catch (error) {
      if (error instanceof McpMessageError) {
        writeProtocolError(response, null, error.protocolCode, error.message);
        return true;
      }
      throw error;
    }
    if (
      !isMcpRecord(message) ||
      message.jsonrpc !== "2.0" ||
      typeof message.method !== "string"
    ) {
      writeProtocolError(
        response,
        mcpRequestId(message),
        -32600,
        "Invalid Request",
      );
      return true;
    }
    if (isInitializeRequest(message)) {
      writeResult(response, message.id, mcpInitializeResult());
      return true;
    }
    if (request.headers["mcp-protocol-version"] !== MCP_PROTOCOL_VERSION) {
      writeProtocolVersionError(response, mcpRequestId(message));
      return true;
    }
    if (isMcpNotification(message)) {
      writeAccepted(response);
      return true;
    }
    if (!isMcpOperationRequest(message)) {
      writeProtocolError(
        response,
        mcpRequestId(message),
        -32600,
        "Invalid Request",
      );
      return true;
    }
    if (message.method === "ping" && hasEmptyMcpParameters(message.params)) {
      writeResult(response, message.id, {});
      return true;
    }
    if (message.method === "tools/list") {
      if (!hasEmptyMcpParameters(message.params)) {
        writeProtocolError(response, message.id, -32602, "Invalid params");
      } else {
        writeResult(response, message.id, { tools: MCP_TOOLS });
      }
      return true;
    }
    if (message.method === "resources/templates/list") {
      if (!hasEmptyMcpParameters(message.params)) {
        writeProtocolError(response, message.id, -32602, "Invalid params");
      } else {
        writeResult(response, message.id, {
          resourceTemplates: MCP_RESOURCE_TEMPLATES,
        });
      }
      return true;
    }
    if (message.method === "resources/list") {
      if (!hasEmptyMcpParameters(message.params)) {
        writeProtocolError(response, message.id, -32602, "Invalid params");
      } else {
        writeResult(response, message.id, { resources: [] });
      }
      return true;
    }
    if (message.method === "tools/call") {
      const startedAt = performance.now();
      if (!isToolCallParameters(message.params)) {
        writeProtocolError(response, message.id, -32602, "Invalid params");
        return true;
      }
      const name = message.params.name;
      const recordOutcome = createMcpOutcomeRecorder(
        recordMcpOperation,
        startedAt,
        message.id,
        name,
      );
      if (
        typeof name !== "string" ||
        ![
          "quality_bar.list_repositories",
          "quality_bar.get_repository_guidance",
        ].includes(name)
      ) {
        writeProtocolError(response, message.id, -32602, "Unknown tool");
        return true;
      }
      try {
        if (name === "quality_bar.list_repositories") {
          const page = repositories.listPage(
            listRepositoryArguments(message.params.arguments ?? {}),
          );
          const document = {
            items: page.items,
            next_cursor: page.next_cursor,
            repositories: repositories.list(),
          };
          const result = toolSuccess(document, page.items.map(repositoryLink));
          recordOutcome(
            "success",
            page.items.map(({ id }) => id),
          );
          writeResult(response, message.id, result);
          return true;
        }
        const { repositoryId } = guidanceArguments(
          message.params.arguments ?? {},
        );
        const document = repositoryGuidance.read(repositoryId);
        const repository = document.repository;
        const guidanceUri = `${repositoryUri(repository)}/guidance`;
        const result = toolSuccess(document, [
          repositoryLink(repository),
          {
            mimeType: "application/json",
            name: `${repository.id} Guidance`,
            type: "resource_link",
            uri: guidanceUri,
          },
        ]);
        recordOutcome("success", [repository.id]);
        writeResult(response, message.id, result);
        return true;
      } catch (error) {
        const result = toolFailure(error);
        recordOutcome("failure", [], result.structuredContent.error.code);
        writeResult(response, message.id, result);
        return true;
      }
    }
    if (message.method === "resources/read") {
      const startedAt = performance.now();
      const recordOutcome = createMcpOutcomeRecorder(
        recordMcpOperation,
        startedAt,
        message.id,
        message.method,
      );
      if (!isResourceReadParameters(message.params)) {
        writeProtocolError(response, message.id, -32602, "Invalid params");
        return true;
      }
      const uri = message.params.uri;
      const match = repositoryResourceMatch(uri);
      if (!match) {
        writeProtocolError(
          response,
          message.id,
          -32602,
          "Invalid resource URI",
        );
        return true;
      }
      try {
        const document = match.guidance
          ? repositoryGuidance.read(match.repositoryId)
          : repositories.list().find(({ id }) => id === match.repositoryId);
        if (!document) {
          throw mcpError("repository_not_found", "Repository was not found");
        }
        recordOutcome("success", [match.repositoryId]);
        writeResult(response, message.id, {
          contents: [
            {
              mimeType: "application/json",
              text: JSON.stringify(document),
              uri,
            },
          ],
        });
        return true;
      } catch (error) {
        const document = errorDocument(error);
        recordOutcome("failure", [match.repositoryId], document.error.code);
        writeProtocolErrorWithData(
          response,
          message.id,
          document.error.code === "repository_not_found" ? -32002 : -32603,
          document.error.message,
          document,
        );
        return true;
      }
    }
    writeProtocolError(response, message.id, -32601, "Method not found");
    return true;
  };
}
