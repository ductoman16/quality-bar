import { CODEX_CAPABILITY_CATALOG } from "../../src/codex-capabilities.js";

const MAX_CANARY_BYTES = 64 * 1024;
const MAX_FAILURE_CODE_LENGTH = 96;
const MAX_FAILURE_DETAIL_LENGTH = 512;
const SEMANTIC_VERSION = /^\d+\.\d+\.\d+$/u;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ATTEMPT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {Record<string, any>} value @param {string[]} keys */
function hasExactKeys(value, keys) {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

/** @param {unknown} value */
function validCommit(value) {
  return typeof value === "string" && COMMIT.test(value);
}

/** @param {unknown} value */
function validTimestamp(value) {
  if (typeof value !== "string") {
    return false;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

/** @param {unknown} value @param {number} maximum */
function boundedString(value, maximum) {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maximum
  );
}

/** @param {unknown} value */
function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
}

/** @param {unknown} value */
function positiveInteger(value) {
  return Number.isSafeInteger(value) && /** @type {number} */ (value) > 0;
}

/** @param {unknown} evidence @param {string} message */
function requireEnvelope(evidence, message) {
  if (
    !isRecord(evidence) ||
    !hasExactKeys(evidence, [
      "completedAt",
      "failure",
      "fixture",
      "kind",
      "observations",
      "outcome",
      "sourceCommit",
      "startedAt",
      "versions",
    ]) ||
    !validCommit(evidence.sourceCommit) ||
    !validTimestamp(evidence.startedAt) ||
    !validTimestamp(evidence.completedAt) ||
    Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt) ||
    !["fail", "pass"].includes(evidence.outcome)
  ) {
    throw new TypeError(message);
  }
  let serialized;
  try {
    serialized = JSON.stringify(evidence);
  } catch {
    throw new TypeError(message);
  }
  if (Buffer.byteLength(serialized) > MAX_CANARY_BYTES) {
    throw new TypeError(message);
  }
  return evidence;
}

/** @param {unknown} failure @param {boolean} [requiresAttemptId] */
function validFailure(failure, requiresAttemptId = false) {
  const hasAttemptId = isRecord(failure) && "attemptId" in failure;
  return (
    isRecord(failure) &&
    hasExactKeys(failure, [
      "code",
      "detail",
      ...(hasAttemptId ? ["attemptId"] : []),
      ...("diagnostics" in failure ? ["diagnostics"] : []),
    ]) &&
    hasAttemptId === requiresAttemptId &&
    (!hasAttemptId ||
      (typeof failure.attemptId === "string" &&
        ATTEMPT_ID.test(failure.attemptId))) &&
    boundedString(failure.code, MAX_FAILURE_CODE_LENGTH) &&
    /^[a-z][a-z0-9_]*$/u.test(failure.code) &&
    boundedString(failure.detail, MAX_FAILURE_DETAIL_LENGTH)
  );
}

/** @param {unknown} diagnostics */
function validPaidDiagnostics(diagnostics) {
  if (
    !isRecord(diagnostics) ||
    !hasExactKeys(diagnostics, [
      "commandExecutions",
      "eventsInspected",
      "eventsTruncated",
      "exactSubmissionCommandEvents",
      "failedCommandExecutions",
      "invalidJsonlLines",
      "knownEventCounts",
      "exitCode",
      "signaled",
      "stderrBytes",
      "stdoutBytes",
      "unknownEventTypes",
    ]) ||
    !isRecord(diagnostics.knownEventCounts) ||
    !hasExactKeys(diagnostics.knownEventCounts, [
      "itemCompleted",
      "itemStarted",
      "threadStarted",
      "turnCompleted",
      "turnFailed",
      "turnStarted",
    ])
  ) {
    return false;
  }
  const counts = [
    diagnostics.commandExecutions,
    diagnostics.eventsInspected,
    diagnostics.exactSubmissionCommandEvents,
    diagnostics.failedCommandExecutions,
    diagnostics.invalidJsonlLines,
    diagnostics.stderrBytes,
    diagnostics.stdoutBytes,
    diagnostics.unknownEventTypes,
    ...Object.values(diagnostics.knownEventCounts),
  ];
  return (
    counts.every(nonnegativeInteger) &&
    typeof diagnostics.eventsTruncated === "boolean" &&
    typeof diagnostics.signaled === "boolean" &&
    (diagnostics.exitCode === null ||
      Number.isSafeInteger(diagnostics.exitCode))
  );
}

/** @param {unknown} evidence */
export function validatePaidCodexCanaryEvidence(evidence) {
  const message = "paid Codex canary evidence is invalid";
  const value = requireEnvelope(evidence, message);
  const fixture = value.fixture;
  const versions = value.versions;
  if (
    value.kind !== "paid-codex-canary" ||
    !isRecord(fixture) ||
    !hasExactKeys(fixture, ["file", "id"]) ||
    fixture.file !== "reviewed.txt" ||
    fixture.id !== "paid-codex-canary-fixture-v1" ||
    !isRecord(versions) ||
    !hasExactKeys(versions, ["application", "codex", "node"]) ||
    !boundedString(versions.node, 64) ||
    !/^v\d+\.\d+\.\d+/u.test(versions.node) ||
    (versions.application !== null &&
      (typeof versions.application !== "string" ||
        !SEMANTIC_VERSION.test(versions.application))) ||
    (versions.codex !== null &&
      versions.codex !==
        `codex-cli ${CODEX_CAPABILITY_CATALOG.codex_cli_version}`)
  ) {
    throw new TypeError(message);
  }
  if (value.outcome === "pass") {
    if (
      typeof versions.application !== "string" ||
      typeof versions.codex !== "string" ||
      value.failure !== null ||
      !isRecord(value.observations) ||
      JSON.stringify(value.observations) !==
        JSON.stringify({
          acceptedSubmission: true,
          eventProtocol: "jsonl",
          processGroup: "started",
          submissionCommand: "accepted",
          turnStarted: true,
        })
    ) {
      throw new TypeError(message);
    }
  } else if (
    value.observations !== null ||
    !validFailure(
      value.failure,
      value.failure?.code === "paid_codex_canary_attempt_started",
    ) ||
    ("diagnostics" in value.failure &&
      !validPaidDiagnostics(value.failure.diagnostics))
  ) {
    throw new TypeError(message);
  }
  return value;
}

/** @param {unknown} fixture */
function validPrivateFixture(fixture) {
  return (
    isRecord(fixture) &&
    hasExactKeys(fixture, [
      "base",
      "head",
      "id",
      "pullRequest",
      "repository",
    ]) &&
    boundedString(fixture.id, 128) &&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(fixture.id) &&
    boundedString(fixture.repository, 256) &&
    /^[^/]+\/[^/]+$/u.test(fixture.repository) &&
    positiveInteger(fixture.pullRequest) &&
    validCommit(fixture.base) &&
    validCommit(fixture.head)
  );
}

/** @param {unknown} evidence */
export function validatePrivateGitHubCanaryEvidence(evidence) {
  const message = "private GitHub canary evidence is invalid";
  const value = requireEnvelope(evidence, message);
  const versions = value.versions;
  if (
    value.kind !== "private-github-canary" ||
    !isRecord(versions) ||
    !hasExactKeys(versions, ["application", "git", "githubRest", "node"]) ||
    versions.githubRest !== "2026-03-10" ||
    !boundedString(versions.node, 64) ||
    !/^v\d+\.\d+\.\d+/u.test(versions.node) ||
    (versions.application !== null &&
      (typeof versions.application !== "string" ||
        !SEMANTIC_VERSION.test(versions.application))) ||
    (versions.git !== null && !boundedString(versions.git, 64))
  ) {
    throw new TypeError(message);
  }
  if (value.outcome === "pass") {
    const observations = value.observations;
    if (
      !validPrivateFixture(value.fixture) ||
      typeof versions.application !== "string" ||
      typeof versions.git !== "string" ||
      value.failure !== null ||
      !isRecord(observations) ||
      !hasExactKeys(observations, [
        "aggregate",
        "authentication",
        "exactHead",
        "inline",
        "polling",
        "reconciliation",
        "status",
      ]) ||
      observations.authentication !== "verified" ||
      observations.polling !== "verified" ||
      observations.reconciliation !== "idempotent" ||
      observations.exactHead !== value.fixture.head ||
      !positiveInteger(observations.status) ||
      !positiveInteger(observations.aggregate) ||
      !positiveInteger(observations.inline)
    ) {
      throw new TypeError(message);
    }
  } else if (
    (value.fixture !== null && !validPrivateFixture(value.fixture)) ||
    value.observations !== null ||
    !validFailure(value.failure) ||
    "diagnostics" in value.failure
  ) {
    throw new TypeError(message);
  }
  return value;
}

/** @param {unknown} canaries @param {string} sourceCommit */
export function validateRetainedReleaseCanaries(canaries, sourceCommit) {
  if (!isRecord(canaries) || Object.keys(canaries).length === 0) {
    throw new TypeError("release canary evidence is invalid");
  }
  const names = Object.keys(canaries);
  if (names.some((name) => !["paidCodex", "privateGitHub"].includes(name))) {
    throw new TypeError("release canary evidence is invalid");
  }
  try {
    if ("paidCodex" in canaries) {
      validatePaidCodexCanaryEvidence(canaries.paidCodex);
    }
    if ("privateGitHub" in canaries) {
      validatePrivateGitHubCanaryEvidence(canaries.privateGitHub);
    }
  } catch {
    throw new TypeError("release canary evidence is invalid");
  }
  if (
    !validCommit(sourceCommit) ||
    Object.values(canaries).some(
      (canary) => !isRecord(canary) || canary.sourceCommit !== sourceCommit,
    )
  ) {
    throw new TypeError("release canary evidence is invalid");
  }
  return canaries;
}

/** @param {unknown} canaries @param {string} sourceCommit */
export function validateReleaseCanaries(canaries, sourceCommit) {
  const value = validateRetainedReleaseCanaries(canaries, sourceCommit);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["paidCodex", "privateGitHub"]) ||
    value.paidCodex.outcome !== "pass" ||
    value.privateGitHub.outcome !== "pass"
  ) {
    throw new TypeError("release acceptance canary evidence is invalid");
  }
  return value;
}
