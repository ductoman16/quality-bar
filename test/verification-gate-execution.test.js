import assert from "node:assert/strict";
import { test } from "node:test";

import { runGate } from "../scripts/verification/gate-execution.mjs";

test("runGate maps injected command failures to verification failure detail", () => {
  const result = runGate(
    "/",
    {
      name: "commanded",
      failureCode: "commanded_failed",
      arguments: ["--test", "noop"],
      command: "node",
    },
    {
      commandExecutor: () => ({
        status: 1,
        stdout: "",
        stderr: "command executor failure\n",
        signal: null,
        error: undefined,
        pid: 1,
        output: ["command executor failure\n", ""],
      }),
    },
  );

  assert.equal(result.failure?.code, "commanded_failed");
  assert.equal(result.evidence.outcome, "fail");
  assert.equal(result.failure?.detail, "command executor failure");
});

test("runGate retains valid facts when a measured gate hard-fails its budget", () => {
  const facts = JSON.stringify({ outcome: "fail", samples: [12, 14] });
  const result = runGate(
    "/",
    {
      name: "measured",
      failureCode: "measured_failed",
      factsMarker: "MEASURED_FACTS",
      validateFacts: (value) =>
        value &&
        typeof value === "object" &&
        "outcome" in value &&
        value.outcome === "fail"
          ? null
          : "outcome is invalid",
      factsMustPass: true,
      arguments: ["--test", "noop"],
      command: "node",
    },
    {
      commandExecutor: () => ({
        status: 1,
        stdout: `MEASURED_FACTS ${facts}\n`,
        stderr: "budget exceeded\n",
        signal: null,
        error: undefined,
        pid: 1,
        output: [`MEASURED_FACTS ${facts}\n`, "budget exceeded\n"],
      }),
    },
  );

  assert.deepEqual(result.evidence.facts, {
    outcome: "fail",
    samples: [12, 14],
  });
  assert.equal(result.evidence.outcome, "fail");
  assert.equal(result.failure?.code, "measured_failed");
  assert.equal(
    result.failure?.detail,
    'budget exceeded\nMEASURED_FACTS {"outcome":"fail","samples":[12,14]}',
  );
});

test("runGate does not retain passing facts when a measured gate fails elsewhere", () => {
  const facts = JSON.stringify({ outcome: "pass", samples: [12, 14] });
  const result = runGate(
    "/",
    {
      name: "measured",
      failureCode: "measured_failed",
      factsMarker: "MEASURED_FACTS",
      validateFacts: () => null,
      factsMustPass: true,
      arguments: ["--test", "noop"],
      command: "node",
    },
    {
      commandExecutor: () => ({
        status: 1,
        stdout: `MEASURED_FACTS ${facts}\n`,
        stderr: "proof test failed\n",
        signal: null,
        error: undefined,
        pid: 1,
        output: [`MEASURED_FACTS ${facts}\n`, "proof test failed\n"],
      }),
    },
  );

  assert.equal(result.evidence.facts, undefined);
  assert.equal(result.evidence.outcome, "fail");
  assert.equal(result.failure?.code, "measured_failed");
});

test("runGate preserves the owning failure when failed facts are invalid", () => {
  const result = runGate(
    "/",
    {
      name: "measured",
      failureCode: "measured_failed",
      factsMarker: "MEASURED_FACTS",
      validateFacts: () => "facts are invalid",
      factsMustPass: true,
      arguments: ["--test", "noop"],
      command: "node",
    },
    {
      commandExecutor: () => ({
        status: 1,
        stdout: 'MEASURED_FACTS {"outcome":"fail"}\n',
        stderr: "measured command failed\n",
        signal: null,
        error: undefined,
        pid: 1,
        output: [
          'MEASURED_FACTS {"outcome":"fail"}\n',
          "measured command failed\n",
        ],
      }),
    },
  );

  assert.equal(result.evidence.facts, undefined);
  assert.equal(result.evidence.outcome, "fail");
  assert.equal(result.failure?.code, "measured_failed");
  assert.equal(
    result.failure?.detail,
    'measured command failed\nMEASURED_FACTS {"outcome":"fail"}',
  );
});

test("runGate discards parsed facts when facts validation throws", () => {
  const result = runGate(
    "/",
    {
      name: "measured",
      failureCode: "measured_failed",
      factsMarker: "MEASURED_FACTS",
      validateFacts: () => {
        throw new Error("facts validator crashed");
      },
      arguments: ["--test", "noop"],
      command: "node",
    },
    {
      commandExecutor: () => ({
        status: 0,
        stdout: '# tests 1\nMEASURED_FACTS {"outcome":"pass"}\n',
        stderr: "",
        signal: null,
        error: undefined,
        pid: 1,
        output: ['# tests 1\nMEASURED_FACTS {"outcome":"pass"}\n', ""],
      }),
    },
  );

  assert.equal(result.evidence.facts, undefined);
  assert.equal(result.evidence.outcome, "fail");
  assert.equal(result.failure?.code, "verification_evidence_invalid");
  assert.match(
    result.failure?.detail ?? "",
    /^MEASURED_FACTS validator failed:/u,
  );
});

test("runGate hard-fails a measured gate when facts report a budget failure", () => {
  const facts = JSON.stringify({ outcome: "fail", samples: [12, 14] });
  const result = runGate(
    "/",
    {
      name: "measured",
      failureCode: "measured_failed",
      factsMarker: "MEASURED_FACTS",
      validateFacts: () => null,
      factsMustPass: true,
      arguments: ["--test", "noop"],
      command: "node",
    },
    {
      commandExecutor: () => ({
        status: 0,
        stdout: `# tests 1\nMEASURED_FACTS ${facts}\n`,
        stderr: "",
        signal: null,
        error: undefined,
        pid: 1,
        output: [`# tests 1\nMEASURED_FACTS ${facts}\n`, ""],
      }),
    },
  );

  assert.deepEqual(result.evidence.facts, {
    outcome: "fail",
    samples: [12, 14],
  });
  assert.equal(result.evidence.outcome, "fail");
  assert.equal(result.failure?.code, "measured_failed");
  assert.equal(result.failure?.detail, "MEASURED_FACTS outcome must be pass");
});
