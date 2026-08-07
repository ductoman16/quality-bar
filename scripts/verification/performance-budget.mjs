import { readFileSync } from "node:fs";

import { REVIEW_RUN_DEADLINE_MILLISECONDS } from "../../src/review-run-deadline.js";

export const PERFORMANCE_SAMPLE_COUNT = 20;
export const PERFORMANCE_PROFILE = Object.freeze({
  cpu_cores: 4,
  memory_gib: 8,
});

const GIB = 1024 ** 3;

/** @param {string} path @returns {string | null} */
function readOptionalLimit(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

/** @param {string[]} paths @returns {string | null} */
function readFirstAvailableLimit(paths) {
  for (const path of paths) {
    const value = readOptionalLimit(path);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function readExecutionProfile() {
  const cpuLimit = readFirstAvailableLimit(["/sys/fs/cgroup/cpu.max"]);
  const cpuQuotaV1 = readFirstAvailableLimit([
    "/sys/fs/cgroup/cpu/cpu.cfs_quota_us",
    "/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us",
    "/sys/fs/cgroup/cpuacct/cpu.cfs_quota_us",
  ]);
  const cpuPeriodV1 = readFirstAvailableLimit([
    "/sys/fs/cgroup/cpu/cpu.cfs_period_us",
    "/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_period_us",
    "/sys/fs/cgroup/cpuacct/cpu.cfs_period_us",
  ]);
  const memoryLimit = readFirstAvailableLimit(["/sys/fs/cgroup/memory.max"]);
  const memoryLimitV1 = readFirstAvailableLimit([
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",
    "/sys/fs/cgroup/memory,memory.oom/memory.limit_in_bytes",
  ]);
  const cpuParts = cpuLimit?.split(/\s+/u) ?? [];
  const cpuQuota = cpuParts[0] ?? cpuQuotaV1;
  const cpuPeriod = cpuParts[1] ?? cpuPeriodV1;
  const parsedCpuQuota = cpuQuota ? Number(cpuQuota) : 0;
  const parsedCpuPeriod = cpuPeriod ? Number(cpuPeriod) : 0;
  const cpuCores =
    Number.isFinite(parsedCpuQuota) &&
    parsedCpuQuota > 0 &&
    Number.isFinite(parsedCpuPeriod) &&
    parsedCpuPeriod > 0
      ? parsedCpuQuota / parsedCpuPeriod
      : 0;
  const memoryValue = memoryLimit ?? memoryLimitV1;
  const parsedMemoryBytes = memoryValue ? Number(memoryValue) : 0;
  const memoryBytes =
    Number.isFinite(parsedMemoryBytes) &&
    parsedMemoryBytes > 0 &&
    parsedMemoryBytes < 2 ** 60
      ? parsedMemoryBytes
      : 0;
  return {
    cpu_cores: cpuCores,
    memory_gib: memoryBytes / GIB,
  };
}

export const PERFORMANCE_EXECUTION_PROFILE = Object.freeze(
  readExecutionProfile(),
);
export const PERFORMANCE_FIXTURE_VERSIONS = Object.freeze({
  readiness: "current-schema-readiness-v1",
  local_read: "local-api-read-v1",
  accepted_local_mutation: "local-api-accepted-mutation-v1",
  ready_queue_claim: "ready-queue-claim-v1",
});
export const PERFORMANCE_THRESHOLDS_MS = Object.freeze({
  readiness_max: 30_000,
  local_read_p95: 250,
  accepted_local_mutation_max: 500,
  ready_queue_claim_max: 1_000,
});
export const CODEX_EXECUTION_DEADLINE_MS = REVIEW_RUN_DEADLINE_MILLISECONDS;

/**
 * @typedef {{
 *   fixture_versions: Record<string, string>,
 *   profile: {cpu_cores: number, memory_gib: number},
 *   execution_profile: {cpu_cores: number, memory_gib: number},
 *   sample_count: number,
 *   durations_ms: Record<string, {samples: number[], p95_ms: number, max_ms: number}>,
 *   thresholds_ms: Record<string, number>,
 *   external_latency: "excluded",
 *   codex_execution_deadline_ms: number,
 *   outcome: "pass" | "fail",
 * }} PerformanceFacts
 */

const METRICS = /** @type {const} */ ([
  "readiness",
  "local_read",
  "accepted_local_mutation",
  "ready_queue_claim",
]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {Record<string, unknown>} record @param {readonly string[]} keys */
function hasExactKeys(record, keys) {
  return Object.keys(record).sort().join("\0") === [...keys].sort().join("\0");
}

/** @param {unknown} value @param {string} field */
function requireDurationSamples(value, field) {
  if (
    !Array.isArray(value) ||
    value.length !== PERFORMANCE_SAMPLE_COUNT ||
    value.some((sample) => !Number.isSafeInteger(sample) || sample < 0)
  ) {
    throw new TypeError(
      `${field} must contain exactly ${PERFORMANCE_SAMPLE_COUNT} nonnegative integer samples`,
    );
  }
  return /** @type {unknown[]} */ (value).map(
    (sample) => /** @type {number} */ (sample),
  );
}

/** @param {number[]} samples */
export function percentile95(samples) {
  if (samples.length === 0) {
    throw new TypeError("performance samples cannot be empty");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

/**
 * @param {{
 *   durationsMs: Record<"readiness" | "local_read" | "accepted_local_mutation" | "ready_queue_claim", number[]>
 *   executionProfile: {cpu_cores: number, memory_gib: number},
 * }} input
 * @returns {PerformanceFacts}
 */
export function createPerformanceFacts({ durationsMs, executionProfile }) {
  if (
    JSON.stringify(executionProfile) !== JSON.stringify(PERFORMANCE_PROFILE)
  ) {
    throw new TypeError(
      "performance execution profile must exactly match the documented four-core/eight-GiB profile",
    );
  }
  /** @type {Record<string, {samples: number[], p95_ms: number, max_ms: number}>} */
  const durations = {};
  for (const metric of METRICS) {
    const samples = requireDurationSamples(durationsMs[metric], metric);
    durations[metric] = {
      samples,
      p95_ms: percentile95(samples),
      max_ms: Math.max(...samples),
    };
  }
  const outcome = budgetPasses(durations) ? "pass" : "fail";
  return {
    fixture_versions: { ...PERFORMANCE_FIXTURE_VERSIONS },
    profile: { ...PERFORMANCE_PROFILE },
    execution_profile: { ...executionProfile },
    sample_count: PERFORMANCE_SAMPLE_COUNT,
    durations_ms: durations,
    thresholds_ms: { ...PERFORMANCE_THRESHOLDS_MS },
    external_latency: "excluded",
    codex_execution_deadline_ms: CODEX_EXECUTION_DEADLINE_MS,
    outcome,
  };
}

/** @param {Record<string, {samples: number[], p95_ms: number, max_ms: number}>} durations */
function budgetPasses(durations) {
  return (
    durations.readiness.max_ms <= PERFORMANCE_THRESHOLDS_MS.readiness_max &&
    durations.local_read.p95_ms <= PERFORMANCE_THRESHOLDS_MS.local_read_p95 &&
    durations.accepted_local_mutation.max_ms <=
      PERFORMANCE_THRESHOLDS_MS.accepted_local_mutation_max &&
    durations.ready_queue_claim.max_ms <=
      PERFORMANCE_THRESHOLDS_MS.ready_queue_claim_max
  );
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function validatePerformanceFacts(value) {
  if (!isRecord(value)) {
    return "performance facts must be an object";
  }
  if (
    !hasExactKeys(value, [
      "fixture_versions",
      "profile",
      "execution_profile",
      "sample_count",
      "durations_ms",
      "thresholds_ms",
      "external_latency",
      "codex_execution_deadline_ms",
      "outcome",
    ])
  ) {
    return "performance facts contain unexpected fields";
  }
  if (
    !isRecord(value.fixture_versions) ||
    !hasExactKeys(value.fixture_versions, METRICS) ||
    JSON.stringify(value.fixture_versions) !==
      JSON.stringify(PERFORMANCE_FIXTURE_VERSIONS)
  ) {
    return "fixture_versions do not match the controlled performance fixtures";
  }
  if (
    !isRecord(value.profile) ||
    !hasExactKeys(value.profile, ["cpu_cores", "memory_gib"]) ||
    JSON.stringify(value.profile) !== JSON.stringify(PERFORMANCE_PROFILE)
  ) {
    return "profile does not match the documented four-core/eight-GiB profile";
  }
  const executionProfile = isRecord(value.execution_profile)
    ? value.execution_profile
    : null;
  const executionCpuCores = executionProfile?.cpu_cores;
  const executionMemoryGib = executionProfile?.memory_gib;
  if (
    !executionProfile ||
    !hasExactKeys(executionProfile, ["cpu_cores", "memory_gib"]) ||
    !Number.isSafeInteger(executionCpuCores) ||
    !Number.isSafeInteger(executionMemoryGib) ||
    JSON.stringify(executionProfile) !== JSON.stringify(PERFORMANCE_PROFILE)
  ) {
    return "execution profile must exactly match the documented four-core/eight-GiB profile";
  }
  if (value.sample_count !== PERFORMANCE_SAMPLE_COUNT) {
    return `sample_count must equal ${PERFORMANCE_SAMPLE_COUNT}`;
  }
  if (
    !isRecord(value.thresholds_ms) ||
    !hasExactKeys(
      value.thresholds_ms,
      Object.keys(PERFORMANCE_THRESHOLDS_MS),
    ) ||
    JSON.stringify(value.thresholds_ms) !==
      JSON.stringify(PERFORMANCE_THRESHOLDS_MS)
  ) {
    return "thresholds_ms do not match the accepted performance budgets";
  }
  if (value.external_latency !== "excluded") {
    return "external_latency must be excluded";
  }
  if (value.codex_execution_deadline_ms !== CODEX_EXECUTION_DEADLINE_MS) {
    return "codex_execution_deadline_ms must preserve the 15-minute deadline";
  }
  if (value.outcome !== "pass" && value.outcome !== "fail") {
    return "outcome must be pass or fail";
  }
  if (
    !isRecord(value.durations_ms) ||
    !hasExactKeys(value.durations_ms, METRICS)
  ) {
    return "durations_ms do not cover every performance fixture";
  }

  /** @type {Record<string, {samples: number[], p95_ms: number, max_ms: number}>} */
  const durations = {};
  const recordedDurations = /** @type {Record<string, unknown>} */ (
    value.durations_ms
  );
  for (const metric of METRICS) {
    const duration = recordedDurations[metric];
    const samplesValue = isRecord(duration) ? duration.samples : undefined;
    const p95Value = isRecord(duration) ? duration.p95_ms : undefined;
    const maxValue = isRecord(duration) ? duration.max_ms : undefined;
    if (
      !isRecord(duration) ||
      !hasExactKeys(duration, ["samples", "p95_ms", "max_ms"]) ||
      !Array.isArray(samplesValue) ||
      samplesValue.length !== PERFORMANCE_SAMPLE_COUNT ||
      samplesValue.some(
        (sample) => !Number.isSafeInteger(sample) || sample < 0,
      ) ||
      !Number.isSafeInteger(p95Value) ||
      /** @type {number} */ (p95Value) < 0 ||
      !Number.isSafeInteger(maxValue) ||
      /** @type {number} */ (maxValue) < 0
    ) {
      return `durations_ms.${metric} contains invalid samples`;
    }
    const samples = /** @type {unknown[]} */ (samplesValue).map(
      (sample) => /** @type {number} */ (sample),
    );
    const p95Ms = /** @type {number} */ (p95Value);
    const maxMs = /** @type {number} */ (maxValue);
    if (p95Ms !== percentile95(samples)) {
      return `durations_ms.${metric}.p95_ms does not match its samples`;
    }
    if (maxMs !== Math.max(...samples)) {
      return `durations_ms.${metric}.max_ms does not match its samples`;
    }
    durations[metric] = {
      samples,
      p95_ms: p95Ms,
      max_ms: maxMs,
    };
  }
  const expectedOutcome = budgetPasses(durations) ? "pass" : "fail";
  if (value.outcome !== expectedOutcome) {
    return "outcome does not match the recorded durations and thresholds";
  }
  return null;
}
