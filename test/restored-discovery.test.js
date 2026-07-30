import assert from "node:assert/strict";
import test from "node:test";

import { requireRestoredDiscoveryBaseline } from "../src/restored-discovery.js";

test("restored discovery clears both live observation cursors before baseline", () => {
  /** @type {{sql: string, parameters: unknown[]}[]} */
  const calls = [];
  /** @type {{run(sql: string, ...parameters: unknown[]): void}} */
  const transaction = {
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
    () => requireRestoredDiscoveryBaseline(/** @type {any} */ ({})),
    /Restored discovery durable core is invalid/u,
  );
});
