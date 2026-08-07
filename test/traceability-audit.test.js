import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

import {
  auditTraceability,
  TRACEABILITY_OWNERSHIP_PATH,
} from "../scripts/verification/traceability-audit.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

/**
 * @typedef {{
 *   ownership_markers: Array<{key: string, sources: string[]}>,
 *   proof_implementations: Record<string, string[]>,
 *   proof_gate_bindings: Record<string, {gate: string, testGroup: string, command: string, arguments: string[], path: string}>,
 *   specification: {
 *     evidence_fields: Array<{id: string, path: string, owners: number[]}>,
 *     source_contracts: Array<{id: string, section: string, scenarios: string[], proof: string[], evidence: string, proof_owners: Record<string, number[]>}>,
 *   },
 * }} TraceabilityMarker
 */

/**
 * @param {(marker: TraceabilityMarker) => void} mutator
 * @param {(directory: string) => void} assertion
 */
function withMarker(mutator, assertion) {
  const directory = mkdtempSync(resolve(tmpdir(), "quality-bar-traceability-"));
  try {
    const marker = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, TRACEABILITY_OWNERSHIP_PATH),
        "utf8",
      ),
    );
    mutator(marker);
    const markerPath = resolve(directory, TRACEABILITY_OWNERSHIP_PATH);
    mkdirSync(dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, JSON.stringify(marker));
    assertion(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test("the complete marker audit proves all source, scenario, proof, and evidence ownership", () => {
  const audit = auditTraceability({ repositoryRoot });
  assert.equal(audit.parent, 25);
  assert.equal(audit.ownerCount, 108);
  assert.equal(audit.sourceContracts.length, 23);
  assert.deepEqual(audit.acceptanceScenarios, [
    "ACC-01",
    "ACC-02",
    "ACC-03",
    "ACC-04",
    "ACC-05",
    "ACC-06",
    "ACC-07",
    "ACC-08",
    "ACC-09",
    "ACC-10",
  ]);
  assert.deepEqual(audit.releaseAcceptance, {
    proof: ["paid-codex-canary", "private-github-canary"],
    owners: [125, 126],
  });
});

test("the audit reports a missing source requirement", () => {
  withMarker(
    (marker) => {
      marker.ownership_markers = marker.ownership_markers.map((owner) => ({
        ...owner,
        sources: owner.sources.filter((source) => source !== "#2"),
      }));
    },
    (directory) =>
      assert.throws(
        () => auditTraceability({ repositoryRoot: directory }),
        /traceability_audit_requirement_missing: #2/u,
      ),
  );
});

test("the audit rejects duplicate-conflicting ownership", () => {
  withMarker(
    (marker) => {
      marker.ownership_markers.push({
        ...marker.ownership_markers[0],
        sources: ["#24"],
      });
    },
    (directory) =>
      assert.throws(
        () => auditTraceability({ repositoryRoot: directory }),
        /traceability_audit_duplicate_conflict/u,
      ),
  );
});

test("the audit rejects stale owner and unproved proof claims", () => {
  withMarker(
    (marker) => {
      marker.ownership_markers[0].key = "stale-key";
    },
    (directory) =>
      assert.throws(
        () => auditTraceability({ repositoryRoot: directory }),
        /traceability_audit_owner_stale/u,
      ),
  );
  withMarker(
    (marker) => {
      marker.proof_implementations["adapter-integration"] = [];
    },
    (directory) =>
      assert.throws(
        () => auditTraceability({ repositoryRoot: directory }),
        /traceability_audit_proof_unproved: adapter-integration/u,
      ),
  );
  withMarker(
    (marker) => {
      marker.proof_implementations.unit = [TRACEABILITY_OWNERSHIP_PATH];
    },
    (directory) =>
      assert.throws(
        () => auditTraceability({ repositoryRoot: directory }),
        /traceability_audit_proof_implementations_stale/u,
      ),
  );
});

test("the audit rejects a missing expected evidence field", () => {
  withMarker(
    (marker) => {
      marker.specification.evidence_fields.pop();
    },
    (directory) =>
      assert.throws(
        () => auditTraceability({ repositoryRoot: directory }),
        /traceability_audit_evidence_fields_stale/u,
      ),
  );
});

test("the audit rejects a stale source contract mapping", () => {
  withMarker(
    (marker) => {
      marker.specification.source_contracts[0].evidence =
        "stale evidence mapping";
    },
    (directory) =>
      assert.throws(
        () => auditTraceability({ repositoryRoot: directory }),
        /traceability_audit_requirements_stale/u,
      ),
  );
});

test("the audit binds the packaged API and MCP smoke to its package gate", () => {
  withMarker(
    (marker) => {
      marker.proof_gate_bindings["packaged-api-mcp-smoke"].gate =
        "mcp-integration";
    },
    (directory) =>
      assert.throws(
        () => auditTraceability({ repositoryRoot: directory }),
        /traceability_audit_proof_gate_bindings_stale/u,
      ),
  );
});
