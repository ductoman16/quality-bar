import assert from "node:assert/strict";
import test from "node:test";

import { requireRestoredDiscoveryBaseline } from "../src/restored-discovery.ts";

test("restored discovery clears both live observation cursors before baseline", () => {
  const calls: { sql: string; parameters: unknown[] }[] = [];
  const transaction: { run(sql: string, ...parameters: unknown[]): void } = {
    run(sql, ...parameters) {
      calls.push({ sql, parameters });
    },
  };
  requireRestoredDiscoveryBaseline({
    transaction(callback) {
      callback(transaction);
    },
  });

  assert.equal(calls.length, 3);
  for (const table of ["github_repository_polls", "forgejo_repository_polls"]) {
    assert.match(
      calls.find(({ sql }) => sql.includes(table))?.sql ?? "",
      /baseline_status = 'pending'[\s\S]*last_success_at = NULL[\s\S]*snapshot = NULL/u,
    );
  }
  assert.match(calls[0].sql, /github_poll_gate:[\s\S]*forgejo_poll_gate:/u);
  assert.throws(
    () => requireRestoredDiscoveryBaseline({} as any),
    /Restored discovery durable core is invalid/u,
  );
});
