/**
 * Shared polling iteration skeleton for both forge polling adapters.
 *
 * Both GitHub and Forgejo scan a table of due repository polls, group them
 * by connection, and process each row while tracking (a) connections whose
 * polling attempts have been gated by a failure and (b) connections whose
 * baseline reconciliation has already been completed within the current
 * sweep. The row-processing itself is forge-specific — the adapters supply
 * a `createRun` factory that returns the per-row handler for one sweep.
 */
export function createPollingRunner({
  queryDue,
  createRun,
  storageReserve,
  timestamp,
}: {
  queryDue: (now: number) => any[];
  createRun: (context: {
    dueRows: any[];
    tracking: {
      gatedConnections: Set<any>;
      completedBaselines: Set<any>;
      baselineConnections: Set<any>;
    };
  }) => (row: any, baseline: boolean) => Promise<unknown> | unknown;
  storageReserve: { preparePollingObservationAdvance: () => unknown };
  timestamp: () => number;
}) {
  if (
    typeof queryDue !== "function" ||
    typeof createRun !== "function" ||
    typeof storageReserve?.preparePollingObservationAdvance !== "function" ||
    typeof timestamp !== "function"
  ) {
    throw new TypeError("Polling runner dependencies are invalid");
  }
  let running = false;
  async function runDue() {
    if (running) {
      return;
    }
    storageReserve.preparePollingObservationAdvance();
    running = true;
    try {
      const dueRows = queryDue(timestamp());
      const gatedConnections = new Set();
      const baselineConnections = new Set(
        dueRows
          .filter((row: any) => row.baseline_status !== "complete")
          .map((row: any) => row.connection_id),
      );
      const completedBaselines = new Set();
      const runRow = createRun({
        dueRows,
        tracking: {
          gatedConnections,
          completedBaselines,
          baselineConnections,
        },
      });
      for (const row of dueRows) {
        if (gatedConnections.has(row.connection_id)) {
          continue;
        }
        if (
          baselineConnections.has(row.connection_id) &&
          completedBaselines.has(row.connection_id)
        ) {
          continue;
        }
        const baseline = baselineConnections.has(row.connection_id);
        await runRow(row, baseline);
      }
    } finally {
      running = false;
    }
  }
  return { runDue };
}
