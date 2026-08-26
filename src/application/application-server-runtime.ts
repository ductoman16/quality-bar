import { createApplicationServer } from "../server.ts";
import { StorageReserveError } from "../storage-reserve.ts";

function createMcpOperationRecorder(writeLog: (line: string) => unknown) {
  return function recordMcpOperation(input: any) {
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

export function createApplicationRuntimeServer(options: any) {
  const {
    browserSessions,
    codexCapabilityFailure,
    implementerTokens,
    storageReserve,
    systemResource,
    writeLog,
  } = options;
  return createApplicationServer({
    ...options,
    readSystemStatus() {
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
    listAuthorityAttributions(query: { cursor?: string; limit?: string }) {
      return systemResource.listAuthorityAttributions(query);
    },
    recordAuthorityAttribution(event: {
      action: string;
      channel: string;
      errorCode?: string;
      outcome: string;
    }) {
      return systemResource.recordAuthorityAttribution(event);
    },
    recordMcpOperation: createMcpOperationRecorder(writeLog),
  });
}
