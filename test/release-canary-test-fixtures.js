export const releaseCanarySourceCommit = "a".repeat(40);

/** @param {Record<string, unknown>} [overrides] */
export function paidCodexPass(overrides = {}) {
  return {
    completedAt: "2023-11-14T22:13:20.123Z",
    failure: null,
    fixture: {
      file: "reviewed.txt",
      id: "paid-codex-canary-fixture-v1",
    },
    invocation: {
      attemptId: "00000000-0000-4000-8000-000000000001",
      command: "canary:paid-codex",
    },
    kind: "paid-codex-canary",
    observations: {
      acceptedSubmission: true,
      eventProtocol: "jsonl",
      processGroup: "started",
      submissionCommand: "accepted",
      turnStarted: true,
    },
    outcome: "pass",
    sourceCommit: releaseCanarySourceCommit,
    startedAt: "2023-11-14T22:13:20.000Z",
    versions: {
      application: "1.2.3",
      codex: "codex-cli 0.145.0",
      node: process.version,
    },
    ...overrides,
  };
}

/** @param {Record<string, unknown>} [overrides] */
export function paidCodexFailure(overrides = {}) {
  return {
    ...paidCodexPass(),
    failure: {
      code: "paid_codex_canary_event_evidence_missing",
      detail: "paid Codex canary JSONL event evidence is incomplete",
    },
    observations: null,
    outcome: "fail",
    ...overrides,
  };
}

/** @param {Record<string, unknown>} [overrides] */
export function privateGitHubPass(overrides = {}) {
  return {
    completedAt: "2023-11-14T22:13:20.123Z",
    failure: null,
    fixture: {
      base: "b".repeat(40),
      head: "c".repeat(40),
      id: "private-github-canary-fixture-v1",
      pullRequest: 7,
      repository: "quality-bar/private-canary",
    },
    invocation: {
      attemptId: "00000000-0000-4000-8000-000000000002",
      command: "canary:private-github",
    },
    kind: "private-github-canary",
    observations: {
      aggregate: 12,
      authentication: "verified",
      exactHead: "c".repeat(40),
      inline: 13,
      polling: "verified",
      reconciliation: "idempotent",
      status: 11,
    },
    outcome: "pass",
    sourceCommit: releaseCanarySourceCommit,
    startedAt: "2023-11-14T22:13:20.000Z",
    versions: {
      application: "1.2.3",
      git: "2.47.0",
      githubRest: "2026-03-10",
      node: process.version,
    },
    ...overrides,
  };
}

/** @param {Record<string, unknown>} [overrides] */
export function privateGitHubFailure(overrides = {}) {
  return {
    ...privateGitHubPass(),
    failure: {
      code: "private_github_canary_authentication_failed",
      detail: "private GitHub canary authentication failed",
    },
    fixture: null,
    observations: null,
    outcome: "fail",
    versions: {
      application: null,
      git: null,
      githubRest: "2026-03-10",
      node: process.version,
    },
    ...overrides,
  };
}
