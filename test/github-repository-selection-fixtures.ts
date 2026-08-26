import assert from "node:assert/strict";

import { GitHubConnectionError } from "../src/github/github-connection-error.ts";
import { RepositoryError } from "../src/repository/repository-validation.ts";
import { assertGitHubSiblingRetirementRace } from "./github-repository-selection-race-support.ts";

export const capabilities = {
  aggregate_feedback: "verified",
  branch_access: "verified",
  commit_status: "verified",
  enumeration: "verified",
  inline_feedback: "verified",
  private_git_read: "verified",
  pull_request_access: "verified",
} as any;

const publicRepository = {
  api_url: "https://api.github.com/repos/operator/beta",
  clone_url: "https://github.com/operator/beta.git",
  full_name: "operator/beta",
  html_url: "https://github.com/operator/beta",
  id: 202,
  private: false,
};

export const availableRepositories = [
  {
    api_url: "https://api.github.com/repos/operator/alpha",
    clone_url: "https://github.com/operator/alpha.git",
    full_name: "operator/alpha",
    html_url: "https://github.com/operator/alpha",
    id: 101,
    private: true,
  },
  publicRepository,
];
export const removedRepositoryState = {
  health: "error",
  health_error_code: "github_repository_selection_unavailable",
};

export function createSelectionRequests() {
  let sequence = 0;
  return (repositoryIds: number[]) => {
    sequence += 1;
    return {
      repository_ids: repositoryIds,
      request_id: `00000000-0000-4000-8000-${String(sequence).padStart(
        12,
        "0",
      )}`,
    };
  };
}
const removedVerificationState = {
  affected_repository_ids: [202],
  error: {
    code: "github_repository_selection_unavailable",
    message: "GitHub Repository is no longer accessible to the Connection",
    repository_id: 202,
  },
  outcome: "error",
  repository_checks: [{ outcome: "error", repository_id: 202 }],
  trigger: "repository_selection",
  verified_at: 3_000,
};

export function assertRemovedVerificationState(
  connection: any,
  repositories: any[],
) {
  const verification = connection?.verification_history.at(-1);
  assert.deepEqual(
    {
      affected_repository_ids: verification?.affected_repository_ids,
      capabilities: verification?.capabilities,
      error: verification?.error,
      outcome: verification?.outcome,
      permissions: verification?.permissions,
      principal: verification?.principal,
      repositories: verification?.repositories,
      repository_checks: verification?.repository_checks,
      trigger: verification?.trigger,
      verified_at: verification?.verified_at,
    },
    {
      ...removedVerificationState,
      capabilities,
      permissions: {
        contents: "read",
        issues: "write",
        metadata: "read",
        pull_requests: "write",
        statuses: "write",
      },
      principal: { id: 91, login: "operator", type: "User" },
      repositories,
    },
  );
}

export async function assertCorrelatedSelection(
  service: any,
  request: { repository_ids: number[]; request_id: string },
) {
  await service.selectRepositories(request);
  assert.equal(
    service.read()?.verification_history.at(-1)?.id,
    request.request_id,
  );
}

export function markPrivateRepositoryUnhealthy(core: {
  run(sql: string): unknown;
}) {
  core.run(
    `UPDATE repositories
     SET health = 'error',
         health_error_code = 'github_repository_git_read_failed',
         health_error_message = 'GitHub Repository Git read verification failed'
     WHERE id = 'repository-alpha'`,
  );
}

export function renamePrivateRepository() {
  availableRepositories[0] = {
    ...availableRepositories[0],
    clone_url: "https://github.com/operator/alpha-renamed.git",
    full_name: "operator/alpha-renamed",
    html_url: "https://github.com/operator/alpha-renamed",
    api_url: "https://api.github.com/repos/operator/alpha-renamed",
  };
}

export function readPrivateRepositoryState(core: {
  get(sql: string): unknown;
}) {
  return core.get(
    `SELECT normalized_url, verified_at, health, name, verification_id
     FROM repositories
     JOIN github_repositories ON repository_id = repositories.id
     WHERE repositories.id = 'repository-alpha'`,
  );
}

export function readRemovedRepositoryState(core: {
  get(sql: string): unknown;
}) {
  return core.get(
    `SELECT health, health_error_code
     FROM repositories
     WHERE id = 'repository-beta'`,
  );
}

export function readGitHubVerificationCount(core: { get(sql: string): any }) {
  return core.get(
    "SELECT count(*) AS count FROM github_connection_verifications",
  )?.count;
}

export async function assertGitHubRepositoryReactivation(
  core: any,
  repositories: ReturnType<
    typeof import("../src/repository/repository.ts").createRepositoryService
  >,
  githubConnections: { selectRepositories(request: unknown): Promise<unknown> },
  setVerificationFailure: (fails: boolean) => void,
) {
  core.run(
    "UPDATE repositories SET has_been_used = 1 WHERE id = ?",
    "repository-alpha",
  );
  assert.equal(
    (
      await repositories.setLifecycle("repository-alpha", {
        lifecycle: "retired",
      })
    ).lifecycle,
    "retired",
  );
  setVerificationFailure(false);
  await githubConnections.selectRepositories({
    repository_ids: [101],
    request_id: "00000000-0000-4000-8000-000000000010",
  });
  assert.equal(repositories.list()[0].id, "repository-alpha");
  assert.equal(repositories.list()[0].lifecycle, "enabled");
  assert.equal(
    (
      await repositories.setLifecycle("repository-alpha", {
        lifecycle: "retired",
      })
    ).lifecycle,
    "retired",
  );
  setVerificationFailure(true);
  await assert.rejects(
    repositories.setLifecycle("repository-alpha", {
      lifecycle: "enabled",
    }),
    { code: "github_repository_git_read_failed" },
  );
  assert.equal(repositories.list()[0].lifecycle, "retired");
  setVerificationFailure(false);
  const reactivated = await repositories.setLifecycle("repository-alpha", {
    lifecycle: "enabled",
  });
  assert.equal(reactivated.id, "repository-alpha");
  assert.equal(reactivated.lifecycle, "enabled");
}

export function assertFailedGitHubRepositoryEnablement(
  repositories: ReturnType<
    typeof import("../src/repository/repository.ts").createRepositoryService
  >,
) {
  const failedEnablement = repositories.list()[0];
  assert.equal(failedEnablement.lifecycle, "disabled");
  assert.equal(failedEnablement.health, "error");
  assert.deepEqual(failedEnablement.health_error, {
    code: "github_repository_git_read_failed",
    message: "GitHub private Repository read verification failed",
  });
}

export function assertSuccessfulGitHubRepositoryEnablement(
  repository: any,
  verificationCalls: any[],
) {
  assert.equal(repository.lifecycle, "enabled");
  if (!("verified_at" in repository)) {
    throw new Error("GitHub Repository verification timestamp is missing");
  }
  assert.equal(repository.verified_at, 4_000);
  assert.equal(verificationCalls.at(-1).repositoryIds[0], 101);
}

export async function assertGitHubLifecycleVerification(options: any) {
  const {
    core,
    repositories,
    setRetireSiblingOnVerification,
    service,
    setConnectionFailure,
    setRetireOnConnectionFailure,
    setRetireOnSelectionFailure,
    setSelectionFailure,
    setStale,
    verificationCalls,
  } = options;
  const enabled = await repositories.setLifecycle("repository-alpha", {
    lifecycle: "enabled",
  });
  assertSuccessfulGitHubRepositoryEnablement(enabled, verificationCalls);
  await repositories.setLifecycle("repository-alpha", {
    lifecycle: "disabled",
  });

  const connectionVerificationCount = readGitHubVerificationCount(core);
  setConnectionFailure(
    new GitHubConnectionError(
      "github_permissions_mismatch",
      "GitHub App permissions do not match the required profile",
    ),
  );
  await assert.rejects(
    repositories.setLifecycle("repository-alpha", { lifecycle: "enabled" }),
    { code: "github_permissions_mismatch" },
  );
  assert.deepEqual(service.read()?.health_error, {
    code: "github_permissions_mismatch",
    message: "GitHub App permissions do not match the required profile",
  });
  assert.equal(
    readGitHubVerificationCount(core),
    connectionVerificationCount + 1,
  );

  setConnectionFailure(undefined);
  setSelectionFailure(true);
  const failedVerificationCount = readGitHubVerificationCount(core);
  await assert.rejects(
    () =>
      repositories.setLifecycle("repository-alpha", {
        lifecycle: "enabled",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "github_repository_git_read_failed",
  );
  assert.equal(readGitHubVerificationCount(core), failedVerificationCount + 1);
  assertFailedGitHubRepositoryEnablement(repositories);
  await assertGitHubRepositoryReactivation(
    core,
    repositories,
    service,
    setSelectionFailure,
  );

  await repositories.setLifecycle("repository-alpha", {
    lifecycle: "retired",
  });
  await assertGitHubSiblingRetirementRace(
    core,
    repositories,
    setConnectionFailure,
    setRetireSiblingOnVerification,
  );
  const failureCountBeforeRetirement = readGitHubVerificationCount(core);
  setSelectionFailure(true);
  setRetireOnSelectionFailure(true);
  await assert.rejects(
    repositories.setLifecycle("repository-alpha", { lifecycle: "enabled" }),
    { code: "github_repository_enablement_conflict" },
  );
  assert.equal(readGitHubVerificationCount(core), failureCountBeforeRetirement);
  assert.equal(repositories.list()[0].lifecycle, "retired");
  assert.equal(service.read()?.lifecycle, "retired");
  setSelectionFailure(false);
  setRetireOnSelectionFailure(false);
  await service.reactivate({ pem: "replacement-private-key" });
  const connectionFailureCount = readGitHubVerificationCount(core);
  setConnectionFailure(
    new GitHubConnectionError(
      "github_permissions_mismatch",
      "GitHub App permissions do not match the required profile",
    ),
  );
  setRetireOnConnectionFailure(true);
  await assert.rejects(
    repositories.setLifecycle("repository-alpha", { lifecycle: "enabled" }),
    { code: "github_repository_enablement_conflict" },
  );
  assert.equal(readGitHubVerificationCount(core), connectionFailureCount);
  assert.equal(repositories.list()[0].lifecycle, "retired");
  assert.equal(service.read()?.lifecycle, "retired");
  setConnectionFailure(undefined);
  setRetireOnConnectionFailure(false);
  await service.reactivate({ pem: "replacement-private-key" });
  const preparedBeforeRetirement = await service.selectRepositories(
    { repository_ids: [101] },
    "enablement",
    { deferCommit: true },
  );
  const verificationCountBeforeRetirement = readGitHubVerificationCount(core);
  assert.equal(service.retire({ lifecycle: "retired" })?.lifecycle, "retired");
  assert.throws(() => core.transaction(preparedBeforeRetirement.commit), {
    code: "github_repository_enablement_conflict",
  });
  assert.equal(
    readGitHubVerificationCount(core),
    verificationCountBeforeRetirement,
  );
  assert.equal(repositories.list()[0].lifecycle, "retired");
  await service.reactivate({ pem: "replacement-private-key" });
  await repositories.setLifecycle("repository-alpha", {
    lifecycle: "enabled",
  });
  assert.throws(() => service.retire({ lifecycle: "retired" }), {
    code: "github_connection_repositories_active",
  });
  await repositories.setLifecycle("repository-alpha", {
    lifecycle: "retired",
  });
  const staleVerificationCount = readGitHubVerificationCount(core);
  setStale(true);
  setSelectionFailure(true);
  await assert.rejects(
    repositories.setLifecycle("repository-alpha", { lifecycle: "enabled" }),
    { code: "github_repository_enablement_conflict" },
  );
  assert.equal(repositories.list()[0].lifecycle, "retired");
  assert.equal(readGitHubVerificationCount(core), staleVerificationCount);
}
