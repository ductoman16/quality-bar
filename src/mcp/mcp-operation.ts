export function recordMcpOutcome(
  record: (event: {
    durationMs: number;
    errorCode?: string;
    operation: string;
    outcome: "success" | "failure";
    requestId: string;
    resourceIds: string[];
  }) => void,
  startedAt: number,
  requestId: string | number,
  operation: string,
  outcome: "success" | "failure",
  resourceIds: string[],
  errorCode?: string,
) {
  record({
    durationMs: Math.round(performance.now() - startedAt),
    operation,
    outcome,
    requestId: String(requestId),
    resourceIds,
    ...(errorCode ? { errorCode } : {}),
  });
}

export function createMcpOutcomeRecorder(
  record: Parameters<typeof recordMcpOutcome>[0],
  startedAt: number,
  requestId: string | number,
  operation: string,
) {
  return (
    outcome: "success" | "failure",
    resourceIds: string[],
    errorCode: string | undefined = undefined,
  ) =>
    recordMcpOutcome(
      record,
      startedAt,
      requestId,
      operation,
      outcome,
      resourceIds,
      errorCode,
    );
}
