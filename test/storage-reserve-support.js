import { createForgejoConnectionService as createForgejoService } from "../src/forgejo-connection.js";
import { createGitHubConnectionService as createGitHubService } from "../src/github-connection.js";
import { createGitHubPollingRunner as createGitHubRunner } from "../src/github-polling-runner.js";
import { createIoExecutionPool } from "../src/io-execution-pool.js";

const facts = {
  filesystems: [
    {
      available_bytes: 8 * 1024 ** 3,
      filesystem: "state",
      path: "/var/lib/quality-bar",
      status: "available",
    },
    {
      available_bytes: 7 * 1024 ** 3,
      filesystem: "checkouts",
      path: "/var/cache/quality-bar/checkouts",
      status: "available",
    },
  ],
  reserve_bytes: 5 * 1024 ** 3,
  status: "available",
};
const cleanupFacts = {
  artifacts_removed: 0,
  error: null,
  last_run_at: "2026-08-02T12:00:00.000Z",
  sessions_removed: 0,
  status: "available",
};

export const availableStorageReserve =
  /** @type {ReturnType<typeof import("../src/storage-reserve.js").createStorageReserveGate> & {ioPool: ReturnType<typeof createIoExecutionPool>}} */ (
    /** @type {unknown} */ (
      Object.freeze({
        assertCodexStartAvailable: () => facts,
        assertPollingObservationAdvanceAvailable: () => facts,
        cleanupEligibleData() {},
        ioPool: createIoExecutionPool(),
        preparePollingObservationAdvance: () => facts,
        assertWorkAdmissionAvailable: () => facts,
        readCleanupFacts: () => cleanupFacts,
        readFacts: () => ({ ...facts, cleanup: cleanupFacts }),
      })
    )
  );

export const githubAutomaticEvaluationTestDependencies = Object.freeze({
  async acquirePullRequestChangeset() {
    return {
      base_commit: "a".repeat(40),
      head_commit: "b".repeat(40),
      release() {},
    };
  },
  admitAutomaticEvaluation() {
    return { afterCommit() {}, resource: { id: "test-automatic-evaluation" } };
  },
});

export const forgejoAutomaticEvaluationTestDependencies = Object.freeze({
  async acquirePullRequestChangeset() {
    return {
      base_commit: "a".repeat(40),
      head_commit: "b".repeat(40),
      release() {},
    };
  },
  admitAutomaticEvaluation() {
    return { afterCommit() {}, resource: { id: "test-automatic-evaluation" } };
  },
});

/** @param {number} number */
export function githubPullRequest(number) {
  return {
    base: { sha: "a".repeat(40) },
    draft: false,
    head: { sha: "b".repeat(40) },
    merged_at: null,
    number,
    state: "open",
  };
}

/**
 * @param {Parameters<typeof createForgejoService>[0]} durableCore
 * @param {Omit<Parameters<typeof createForgejoService>[1], "acquirePullRequestChangeset" | "admitAutomaticEvaluation" | "storageReserve">} options
 */
export function createAvailableForgejoConnectionService(durableCore, options) {
  return createForgejoService(durableCore, {
    ...forgejoAutomaticEvaluationTestDependencies,
    ...options,
    storageReserve: availableStorageReserve,
  });
}

/**
 * @param {Parameters<typeof createGitHubService>[0]} durableCore
 * @param {Omit<Parameters<typeof createGitHubService>[1], "acquirePullRequestChangeset" | "admitAutomaticEvaluation" | "storageReserve"> & Partial<Pick<Parameters<typeof createGitHubService>[1], "acquirePullRequestChangeset" | "admitAutomaticEvaluation" | "storageReserve">>} options
 */
export function createAvailableGitHubConnectionService(durableCore, options) {
  return createGitHubService(durableCore, {
    ...githubAutomaticEvaluationTestDependencies,
    ...options,
    ...(options.verifier
      ? {
          verifier: {
            ...options.verifier,
            publishAggregateFeedback:
              options.verifier.publishAggregateFeedback ??
              async function publishAggregateFeedback() {
                return 1;
              },
            publishCommitStatus:
              options.verifier.publishCommitStatus ??
              async function publishCommitStatus() {
                return 1;
              },
            publishInlineFeedback:
              options.verifier.publishInlineFeedback ??
              async function publishInlineFeedback() {
                return 1;
              },
            publishReviewCommentReply:
              options.verifier.publishReviewCommentReply ??
              async function publishReviewCommentReply() {
                return 1;
              },
            reconcileAggregateFeedback:
              options.verifier.reconcileAggregateFeedback ??
              async function reconcileAggregateFeedback() {
                return null;
              },
            reconcileCommitStatus:
              options.verifier.reconcileCommitStatus ??
              async function reconcileCommitStatus() {
                return null;
              },
            reconcileInlineFeedback:
              options.verifier.reconcileInlineFeedback ??
              async function reconcileInlineFeedback() {
                return null;
              },
            reconcileReviewCommentReply:
              options.verifier.reconcileReviewCommentReply ??
              async function reconcileReviewCommentReply() {
                return null;
              },
          },
        }
      : {}),
    storageReserve: availableStorageReserve,
  });
}

/**
 * @param {Parameters<typeof createGitHubRunner>[0]} durableCore
 * @param {Omit<Parameters<typeof createGitHubRunner>[1], "acquirePullRequestChangeset" | "admitAutomaticEvaluation" | "storageReserve"> & Partial<Pick<Parameters<typeof createGitHubRunner>[1], "acquirePullRequestChangeset" | "admitAutomaticEvaluation" | "storageReserve">>} options
 */
export function createAvailableGitHubPollingRunner(durableCore, options) {
  return createGitHubRunner(durableCore, {
    ...githubAutomaticEvaluationTestDependencies,
    ...options,
    storageReserve: availableStorageReserve,
  });
}

/** @param {any} core */
export function seedDueGitHubPoll(core) {
  core.run(
    `INSERT INTO github_connections (
       id, app_id, app_slug, installation_id, principal_id, principal_login,
       api_profile, permissions, capabilities, repository_count,
       created_at, verified_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "connection-1",
    47,
    "quality-bar",
    73,
    91,
    "operator",
    "github-rest:2026-03-10",
    "{}",
    "{}",
    1,
    1,
    1,
  );
  core.run(
    "INSERT INTO github_connection_credentials (connection_id, encrypted_credential, created_at) VALUES (?, ?, ?)",
    "connection-1",
    "encrypted",
    1,
  );
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://github.com/operator/private.git",
    1,
    1,
  );
  core.run(
    `INSERT INTO github_connection_verifications (
       id, connection_id, trigger, outcome, api_profile, principal_id,
       principal_login, permissions, capabilities, affected_repository_ids,
       repository_checks, repositories, verified_at
     ) VALUES (?, ?, 'onboarding', 'success', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "verification-1",
    "connection-1",
    "github-rest:2026-03-10",
    91,
    "operator",
    "{}",
    "{}",
    "[101]",
    '[{"repository_id":101,"outcome":"success"}]',
    '[{"id":101}]',
    1,
  );
  core.run(
    `INSERT INTO github_repositories (
       repository_id, connection_id, forge_repository_id, name,
       api_url, web_url, verification_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    "repository-1",
    "connection-1",
    101,
    "operator/private",
    "https://api.github.com/repos/operator/private",
    "https://github.com/operator/private",
    "verification-1",
  );
  core.run(
    `INSERT INTO github_repository_polls (
       connection_id, forge_repository_id, baseline_status, last_success_at,
       next_attempt_at, snapshot
     ) VALUES (?, ?, 'complete', ?, ?, ?)`,
    "connection-1",
    101,
    5_000,
    65_000,
    "[]",
  );
}
