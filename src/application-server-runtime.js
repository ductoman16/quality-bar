import { createApplicationServer } from "./server.js";
import { StorageReserveError } from "./storage-reserve.js";

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
      if (typeof storageReserve.readCleanupFacts !== "function") {
        throw new StorageReserveError(
          "storage_cleanup_facts_unavailable",
          "Owned storage cleanup facts are unavailable",
          { action: "system_read" },
        );
      }
      const storage = storageReserve.readFacts();
      const cleanup = storageReserve.readCleanupFacts();
      return systemResource.readFacts({
        browserSessions,
        codex: codexCapabilityFailure
          ? { error: codexCapabilityFailure.code, status: "unavailable" }
          : { status: "available" },
        implementerToken: implementerTokens?.hasActiveToken()
          ? { status: "active" }
          : { status: "revoked" },
        storage: { ...storage, cleanup },
      });
    },
    /** @param {{cursor?: string, limit?: string}} query */
    listAuthorityAttributions(query) {
      if (!systemResource) {
        throwStartupFailure(startupFailure);
      }
      return systemResource.listAuthorityAttributions(query);
    },
    /**
     * @param {{action: string, channel: string, errorCode?: string, outcome: string}} event
     */
    recordAuthorityAttribution(event) {
      if (!systemResource) {
        throwStartupFailure(startupFailure);
      }
      return systemResource.recordAuthorityAttribution(event);
    },
    recordMcpOperation: createMcpOperationRecorder(writeLog),
  });
}
