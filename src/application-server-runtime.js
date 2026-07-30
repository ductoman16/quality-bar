import { createApplicationServer } from "./server.js";

/** @param {unknown} failure @returns {never} */
function throwStartupFailure(failure) {
  if (!(failure instanceof Error)) {
    throw new TypeError("Application startup failure is unavailable");
  }
  throw failure;
}

/** @param {(line: string) => unknown} writeLog */
function createMcpOperationRecorder(writeLog) {
  /** @param {any} input */
  return function recordMcpOperation(input) {
    const {
      durationMs,
      errorCode,
      operation,
      outcome,
      requestId,
      resourceIds,
    } = input;
    writeLog(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        severity: outcome === "success" ? "info" : "error",
        event: "mcp_request",
        component: "mcp",
        outcome,
        request_id: requestId,
        operation,
        resource_ids: resourceIds,
        duration_ms: durationMs,
        ...(errorCode ? { error: errorCode } : {}),
      })}\n`,
    );
  };
}

/** @param {any} options */
export function createApplicationRuntimeServer(options) {
  const {
    browserSessions,
    codexCapabilityFailure,
    implementerTokens,
    startupFailure,
    storageReserve,
    systemResource,
    writeLog,
  } = options;
  return createApplicationServer({
    ...options,
    readSystemStatus() {
      if (!systemResource || !storageReserve) {
        throwStartupFailure(startupFailure);
      }
      return systemResource.readFacts({
        browserSessions,
        codex: codexCapabilityFailure
          ? { error: codexCapabilityFailure.code, status: "unavailable" }
          : { status: "available" },
        implementerToken: implementerTokens?.hasActiveToken()
          ? { status: "active" }
          : { status: "revoked" },
        storage: storageReserve.readFacts(),
      });
    },
    listAuthorityAttributions(query) {
      if (!systemResource) {
        throwStartupFailure(startupFailure);
      }
      return systemResource.listAuthorityAttributions(query);
    },
    recordAuthorityAttribution(event) {
      if (!systemResource) {
        throwStartupFailure(startupFailure);
      }
      return systemResource.recordAuthorityAttribution(event);
    },
    recordMcpOperation: createMcpOperationRecorder(writeLog),
  });
}
