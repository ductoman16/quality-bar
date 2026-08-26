import { writeError } from "../http-response.ts";
import {
  MCP_RESOURCE_TEMPLATES,
  MCP_PROTOCOL_VERSION,
  MCP_TOOLS,
  ONBOARDING_MCP_TOOLS,
  mcpInitializeResult,
} from "./mcp-contract.ts";
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
} from "./mcp-message.ts";
import { createMcpOutcomeRecorder } from "./mcp-operation.ts";
import {
  resourceFailure,
  toolFailure,
  toolSuccess,
  writeAccepted,
  writeProtocolError,
  writeProtocolErrorWithData,
  writeProtocolVersionError,
  writeResult,
} from "./mcp-http-response.ts";

export function createMcpOriginHook(browserOrigin: string) {
  return function requireMcpOrigin(
    request: import("fastify").FastifyRequest,
    response: import("fastify").FastifyReply,
    done: () => void,
  ) {
    if (request.headers.origin && request.headers.origin !== browserOrigin) {
      writeError(response, 403, "origin_invalid", "Origin is invalid");
      return;
    }
    done();
  };
}

export function rejectMcpMethod(
  request: import("fastify").FastifyRequest,
  response: import("fastify").FastifyReply,
) {
  void request;
  writeError(response, 405, "method_not_allowed", "Method is not allowed", {
    allow: "POST",
  });
}
import {
  executeEvaluationTool,
  matchWorkflowResource,
  readWorkflowResource,
} from "./mcp-evaluation.ts";
import {
  guidanceArguments,
  listRepositoryArguments,
} from "./mcp-repository.ts";
import { mcpResourceLink } from "./mcp-resource-link.ts";
import {
  isResourceReadParameters,
  isToolCallParameters,
} from "./mcp-validation.ts";
import { executeWaiverTool } from "./mcp-waiver.ts";
import { executeOnboardingTool } from "./mcp-onboarding.ts";

export function createMcpRoute({
  evaluations,
  recordMcpOperation,
  repositories,
  repositoryGuidance,
  onboardingOperations,
}: {
  recordMcpOperation: (event: {
    durationMs: number;
    errorCode?: string;
    operation: string;
    outcome: "success" | "failure";
    requestId: string;
    resourceIds: string[];
  }) => void;
  evaluations: ReturnType<
    typeof import("../evaluation/evaluation.ts").createEvaluationService
  >;
  repositories: Omit<
    ReturnType<
      typeof import("../repository/repository.ts").createRepositoryService
    >,
    "resolvePushedSelectors" | "resolvePullRequestChangeset"
  >;
  repositoryGuidance: ReturnType<
    typeof import("../repository/repository-guidance.ts").createRepositoryGuidanceService
  >;
  onboardingOperations: ReturnType<
    typeof import("../onboarding-operations.ts").createOnboardingOperations
  >;
}) {
  return async function handleMcp(
    request: import("fastify").FastifyRequest,
    response: import("fastify").FastifyReply,
    authority: "callback" | "machine" | "onboarding" | "operator" | undefined,
    onboardingGrant: unknown,
    token: unknown,
  ) {
    if (Object.keys(request.query as object).length > 0) {
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
      return;
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
        writeResult(response, message.id, {
          tools: authority === "onboarding" ? ONBOARDING_MCP_TOOLS : MCP_TOOLS,
        });
      }
      return true;
    }
    if (message.method === "resources/templates/list") {
      if (!hasEmptyMcpParameters(message.params)) {
        writeProtocolError(response, message.id, -32602, "Invalid params");
      } else {
        writeResult(response, message.id, {
          resourceTemplates:
            authority === "onboarding" ? [] : MCP_RESOURCE_TEMPLATES,
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
      const allowedTools =
        authority === "onboarding"
          ? ONBOARDING_MCP_TOOLS.map((tool) => tool.name)
          : MCP_TOOLS.map((tool) => tool.name);
      if (typeof name !== "string" || !allowedTools.includes(name)) {
        writeProtocolError(response, message.id, -32602, "Unknown tool");
        return true;
      }
      try {
        if (authority === "onboarding") {
          const document = await executeOnboardingTool(
            name,
            message.params.arguments ?? {},
            { grant: onboardingGrant, operations: onboardingOperations, token },
          );
          const result = toolSuccess(document, []);
          recordOutcome("success", []);
          writeResult(response, message.id, result);
          return true;
        }
        if (name === "quality_bar.list_repositories") {
          const page = repositories.listPage(
            listRepositoryArguments(message.params.arguments ?? {}),
          );
          const document = page;
          const result = toolSuccess(
            document,
            page.items.map(({ id }) => mcpResourceLink("repositories", id)),
          );
          recordOutcome(
            "success",
            page.items.map(({ id }) => id),
          );
          writeResult(response, message.id, result);
          return true;
        }
        if (name === "quality_bar.get_repository_guidance") {
          const { repositoryId } = guidanceArguments(
            message.params.arguments ?? {},
          );
          const document = repositoryGuidance.read(repositoryId);
          const repository = document.repository;
          const repositoryResource = mcpResourceLink(
            "repositories",
            repository.id,
          );
          const guidanceUri = `${repositoryResource.uri}/guidance`;
          const result = toolSuccess(document, [
            repositoryResource,
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
        }
        const evaluationCall = [
          "quality_bar.submit_waiver_requests",
          "quality_bar.get_waiver_adjudication",
        ].includes(name)
          ? executeWaiverTool(name, message.params.arguments ?? {}, evaluations)
          : await executeEvaluationTool(
              name,
              message.params.arguments ?? {},
              evaluations,
            );
        const result = toolSuccess(
          evaluationCall.document,
          evaluationCall.links,
        );
        recordOutcome("success", evaluationCall.resourceIds);
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
      if (authority === "onboarding") {
        writeProtocolError(
          response,
          message.id,
          -32602,
          "Invalid resource URI",
        );
        return true;
      }
      const uri = message.params.uri;
      const match = matchWorkflowResource(uri);
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
        const document = readWorkflowResource(match, {
          evaluations,
          repositories,
          repositoryGuidance,
        });
        recordOutcome("success", [match.id]);
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
        const { document, protocolCode } = resourceFailure(error);
        recordOutcome("failure", [match.id], document.error.code);
        writeProtocolErrorWithData(
          response,
          message.id,
          protocolCode,
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
