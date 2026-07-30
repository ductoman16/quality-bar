/**
 * Makes restored forge discovery observe a new complete baseline before it
 * compares pull-request state. Snapshot-era observation cannot become a live
 * cursor after an offline restore.
 *
 * @param {{transaction: (callback: (transaction: any) => unknown) => unknown}} durableCore
 */
export function requireRestoredDiscoveryBaseline(durableCore) {
  if (typeof durableCore?.transaction !== "function") {
    throw new TypeError("Restored discovery durable core is invalid");
  }
  durableCore.transaction((transaction) => {
    transaction.run(
      "DELETE FROM quality_bar_metadata WHERE key LIKE 'github_poll_gate:%' OR key LIKE 'forgejo_poll_gate:%'",
    );
    for (const table of [
      "github_repository_polls",
      "forgejo_repository_polls",
    ]) {
      transaction.run(
        `UPDATE ${table}
            SET baseline_status = 'pending',
                last_success_at = NULL,
                error_code = NULL,
                error_message = NULL,
                rate_gate_until = NULL,
                next_attempt_at = 0,
                snapshot = NULL`,
      );
    }
  });
}
