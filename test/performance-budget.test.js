import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CODEX_EXECUTION_DEADLINE_MS,
  PERFORMANCE_PROFILE,
  PERFORMANCE_SAMPLE_COUNT,
  PERFORMANCE_THRESHOLDS_MS,
  createPerformanceFacts,
  percentile95,
  validatePerformanceFacts,
} from "../scripts/verification/performance-budget.mjs";
import { REVIEW_RUN_DEADLINE_MILLISECONDS } from "../src/review-run-deadline.js";

function passingDurations() {
  return {
    readiness: Array(PERFORMANCE_SAMPLE_COUNT).fill(12),
    local_read: Array(PERFORMANCE_SAMPLE_COUNT).fill(8),
    accepted_local_mutation: Array(PERFORMANCE_SAMPLE_COUNT).fill(15),
    ready_queue_claim: Array(PERFORMANCE_SAMPLE_COUNT).fill(4),
  };
}

function createPassingFacts() {
  return createPerformanceFacts({
    durationsMs: passingDurations(),
    executionProfile: PERFORMANCE_PROFILE,
  });
}

test("the performance fixture uses nearest-rank p95 without mutating samples", () => {
  const samples = [9, 1, 7, 3, 5];

  assert.equal(percentile95(samples), 9);
  assert.deepEqual(samples, [9, 1, 7, 3, 5]);
});

test("performance facts record the fixed profile, fixture versions, samples, and thresholds", () => {
  const facts = createPassingFacts();

  assert.equal(facts.sample_count, PERFORMANCE_SAMPLE_COUNT);
  assert.deepEqual(facts.profile, PERFORMANCE_PROFILE);
  assert.deepEqual(facts.execution_profile, PERFORMANCE_PROFILE);
  assert.equal(CODEX_EXECUTION_DEADLINE_MS, REVIEW_RUN_DEADLINE_MILLISECONDS);
  assert.deepEqual(facts.thresholds_ms, PERFORMANCE_THRESHOLDS_MS);
  assert.equal(facts.outcome, "pass");
  assert.equal(validatePerformanceFacts(facts), null);
  assert.deepEqual(
    facts.durations_ms.readiness.samples,
    passingDurations().readiness,
  );
});

test("performance facts reject a changed threshold instead of accepting stale evidence", () => {
  const facts = createPassingFacts();
  facts.thresholds_ms.readiness_max = 31_000;

  assert.equal(
    validatePerformanceFacts(facts),
    "thresholds_ms do not match the accepted performance budgets",
  );
});

test("performance facts reject execution below the documented baseline", () => {
  const facts = createPassingFacts();
  facts.execution_profile.cpu_cores = PERFORMANCE_PROFILE.cpu_cores - 1;

  assert.equal(
    validatePerformanceFacts(facts),
    "execution profile must exactly match the documented four-core/eight-GiB profile",
  );
});

test("performance facts reject a p95 that does not match the recorded samples", () => {
  const facts = createPassingFacts();
  facts.durations_ms.local_read.p95_ms += 1;

  assert.equal(
    validatePerformanceFacts(facts),
    "durations_ms.local_read.p95_ms does not match its samples",
  );
});

test("performance facts preserve a hard budget failure as a failed outcome", () => {
  const durations = passingDurations();
  durations.local_read[durations.local_read.length - 1] =
    PERFORMANCE_THRESHOLDS_MS.local_read_p95 + 1;
  durations.local_read[durations.local_read.length - 2] =
    PERFORMANCE_THRESHOLDS_MS.local_read_p95 + 1;
  const facts = createPerformanceFacts({
    durationsMs: durations,
    executionProfile: PERFORMANCE_PROFILE,
  });

  assert.equal(facts.outcome, "fail");
  assert.equal(validatePerformanceFacts(facts), null);
});

test("performance facts reject an accepted-mutation max outlier", () => {
  const durations = passingDurations();
  durations.accepted_local_mutation[0] =
    PERFORMANCE_THRESHOLDS_MS.accepted_local_mutation_max + 1;
  const facts = createPerformanceFacts({
    durationsMs: durations,
    executionProfile: PERFORMANCE_PROFILE,
  });

  assert.equal(facts.outcome, "fail");
  assert.equal(validatePerformanceFacts(facts), null);
});
